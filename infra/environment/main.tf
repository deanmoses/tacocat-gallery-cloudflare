# One environment's data: its database, its buckets and the queue its uploads are announced through. The Worker that binds
# them is declared per environment in api/wrangler.jsonc.

variable "account_id" {
  type = string
}

variable "prefix" {
  type        = string
  description = "What every resource's name starts with: the environment's name, such as staging."
}

variable "site_origin" {
  type        = string
  description = "The origin the web app runs on, such as https://pix.tacocat.com, which browsers upload from."
}

locals {
  day = 24 * 60 * 60
}

resource "cloudflare_d1_database" "this" {
  account_id            = var.account_id
  name                  = var.prefix
  primary_location_hint = "wnam"
  read_replication      = { mode = "auto" }
  lifecycle {
    prevent_destroy = true
    # The API does not return the hint, so an imported database would otherwise plan a replacement.
    ignore_changes = [primary_location_hint]
  }
}

# The originals, each under a key that never changes. A browser's upload is PUT straight to its key with a URL the
# Worker signed.
resource "cloudflare_r2_bucket" "originals" {
  account_id = var.account_id
  name       = "${var.prefix}-originals"
  location   = "wnam"
  lifecycle {
    prevent_destroy = true
  }
}

# The upload's PUT is a cross-origin request from the site. The one header it sends is the content type the URL was
# signed with.
resource "cloudflare_r2_bucket_cors" "originals" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.originals.name
  rules = [{
    allowed = {
      origins = [var.site_origin]
      methods = ["PUT"]
      headers = ["content-type"]
    }
    max_age_seconds = 3600
  }]
}

# Everything made from an original: image sizes, a video's MP4 and poster. Regenerable, but every image is an Images
# transformation and every video a transcoder run, so losing it is a bill and hours, not a shrug.
resource "cloudflare_r2_bucket" "derived" {
  account_id = var.account_id
  name       = "${var.prefix}-derived"
  location   = "wnam"
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_queue" "uploads" {
  account_id = var.account_id
  queue_name = "${var.prefix}-uploads"
}

# Upload messages that run out of retries land here (see dead_letter_queue in api/wrangler.jsonc).
resource "cloudflare_queue" "uploads_dlq" {
  account_id = var.account_id
  queue_name = "${var.prefix}-uploads-dlq"
}

# Every original written starts the upload pipeline, which leaves alone one no upload was presigned for.
resource "cloudflare_r2_bucket_event_notification" "originals" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.originals.name
  queue_id    = cloudflare_queue.uploads.queue_id
  rules = [{
    prefix = "originals/"
    # The API returns "" for no suffix; null would show a diff on every plan.
    suffix  = ""
    actions = ["PutObject", "CompleteMultipartUpload", "CopyObject"]
  }]
}

output "d1_database_id" {
  value = cloudflare_d1_database.this.id
}

# The S3 key the Worker presigns with: the browser's PUT of an original, the transcoder's read of it and writes into
# derived, and Image Transformations' read of the image a derivative is made from. An R2 token covers whole buckets,
# so signing a PUT of one original takes a key that can write and delete them all. An API token's id is an S3 access
# key id and the SHA-256 of its value the secret.
data "cloudflare_account_api_token_permission_groups_list" "bucket_item_write" {
  account_id = var.account_id
  name       = "Workers R2 Storage Bucket Item Write"
}

resource "cloudflare_account_token" "signing" {
  account_id = var.account_id
  name       = "${var.prefix} signing"
  policies = [{
    effect            = "allow"
    permission_groups = [{ id = data.cloudflare_account_api_token_permission_groups_list.bucket_item_write.result[0].id }]
    resources = jsonencode({
      for bucket in [cloudflare_r2_bucket.originals.name, cloudflare_r2_bucket.derived.name] :
      "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${bucket}" => "*"
    })
  }]
}

output "signing_credentials" {
  value = {
    access_key_id     = cloudflare_account_token.signing.id
    secret_access_key = sha256(cloudflare_account_token.signing.value)
  }
  sensitive = true
}

output "originals_bucket" {
  value = cloudflare_r2_bucket.originals.name
}
