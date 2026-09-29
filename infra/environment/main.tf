# One environment's data: its database, its buckets and the queue its uploads arrive through. The Worker that binds
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
  description = "The origin the web app runs on, such as https://pix.deanmoses.com, which browsers upload from."
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

# One bucket per role, because an R2 API token is scoped to whole buckets: the key the Worker signs upload and
# transcode URLs with reaches uploads and derived, so no URL it signs can touch an original.

# The originals, each under a key that never changes. Written by the Worker's binding alone.
resource "cloudflare_r2_bucket" "originals" {
  account_id = var.account_id
  name       = "${var.prefix}-originals"
  location   = "wnam"
  lifecycle {
    prevent_destroy = true
  }
}

# Where a browser's upload lands, under inbox/, until the pipeline has made an original of it and dropped it.
resource "cloudflare_r2_bucket" "uploads" {
  account_id = var.account_id
  name       = "${var.prefix}-uploads"
  location   = "wnam"
}

# An upload the pipeline could not finish is kept for a replay, and a week is ample; an upload the browser never
# completed would otherwise sit as a multipart upload forever.
resource "cloudflare_r2_bucket_lifecycle" "uploads" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.uploads.name
  rules = [{
    id         = "expire-uploads"
    enabled    = true
    conditions = { prefix = "" }
    delete_objects_transition = {
      condition = { type = "Age", max_age = 7 * local.day }
    }
    abort_multipart_uploads_transition = {
      condition = { type = "Age", max_age = 7 * local.day }
    }
  }]
}

# The browser PUTs an upload straight to the bucket with a URL the Worker signed, which is a cross-origin request
# from the site, and from the local dev server while developing. The one header it sends is the file's own content type.
resource "cloudflare_r2_bucket_cors" "uploads" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.uploads.name
  rules = [{
    allowed = {
      origins = [var.site_origin, "http://localhost:8787"]
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

resource "cloudflare_r2_bucket_event_notification" "uploads" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.uploads.name
  queue_id    = cloudflare_queue.uploads.queue_id
  rules = [{
    prefix = "inbox/"
    # The API returns "" for no suffix; null would show a diff on every plan.
    suffix  = ""
    actions = ["PutObject", "CompleteMultipartUpload", "CopyObject"]
  }]
}

output "d1_database_id" {
  value = cloudflare_d1_database.this.id
}

# The S3 key the Worker presigns with: the browser's PUT into uploads, and the transcoder's read from uploads and
# writes into derived. Those two buckets and nothing else, so no URL the Worker signs can touch an original or a dump.
# An API token's id is an S3 access key id and the SHA-256 of its value the secret.
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
      for bucket in [cloudflare_r2_bucket.uploads.name, cloudflare_r2_bucket.derived.name] :
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
