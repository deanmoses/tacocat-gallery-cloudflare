variable "name" {
  type = string
}

variable "region" {
  type = string
}

resource "aws_s3_bucket" "this" {
  bucket = var.name
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# The history: every overwrite and delete keeps the previous version for 35 days, AWS Backup's retention, so a night
# that copies a bug's damage is undone by copying the versions as they were before it.
resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    id     = "history"
    status = "Enabled"
    filter {
      prefix = ""
    }
    noncurrent_version_expiration {
      noncurrent_days = 35
    }
    # A delete leaves a marker as the current version; once every version under it has expired, the marker goes too.
    expiration {
      expired_object_delete_marker = true
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

# The one identity that reaches the bucket, whose only permissions are the bucket.
resource "aws_iam_user" "this" {
  name = var.name
}

# What rclone sync needs: to list, read, write and delete in this bucket. A delete on a versioned bucket only adds a
# marker; DeleteObjectVersion, which would destroy the history, is left out, so a leaked key cannot empty the backup.
resource "aws_iam_user_policy" "this" {
  name = "${var.name}-bucket"
  user = aws_iam_user.this.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:ListBucketVersions", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.this.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.this.arn}/*"
      },
    ]
  })
}

resource "aws_iam_access_key" "this" {
  user = aws_iam_user.this.name
}

# The bucket as an rclone path with the key in it, which is how the Backup workflow takes its target. The bucket is
# never checked or created, since the key may not.
output "rclone_target" {
  value     = ":s3,provider=AWS,region=${var.region},no_check_bucket=true,access_key_id=${aws_iam_access_key.this.id},secret_access_key=${aws_iam_access_key.this.secret}:${aws_s3_bucket.this.bucket}"
  sensitive = true
}
