terraform {
  required_version = ">= 1.10"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The bucket is made by hand, since a config cannot create the bucket its own state is read from. R2 honours the
  # lock file's create-only PutObject. A backend block cannot read a variable, so scripts/tofu.sh supplies the
  # credentials, and the endpoint's account id must match local.account_id, which the script reads.
  backend "s3" {
    bucket = "opentofu-state"
    key    = "terraform.tfstate"
    region = "auto"
    endpoints = {
      s3 = "https://ed3ca575118099486baeb129959697c8.r2.cloudflarestorage.com"
    }
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

# Reads CLOUDFLARE_API_TOKEN; see README.
provider "cloudflare" {}
