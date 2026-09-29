# Where the nightly Backup workflow copies production's originals and database dumps: a bucket in the AWS account the
# gallery has always run in. A backup belongs with a provider other than the one holding the data, and this account
# needs no new vendor. Everything in it is named and tagged tacocat-gallery-cloudflare, since that account also holds
# the AWS gallery's own resources and a name without "cloudflare" in it would read as one of them. The key is defined
# here as the R2 tokens are, so that no value passes through a person: scripts/secrets.sh backup carries the target to
# the repository from the output below.

variable "aws_access_key_id" {
  type      = string
  sensitive = true
}

variable "aws_secret_access_key" {
  type      = string
  sensitive = true
}

# Set when the AWS CLI's credentials are temporary ones, as with SSO; empty otherwise.
variable "aws_session_token" {
  type      = string
  sensitive = true
  default   = ""
}

locals {
  backup_name   = "tacocat-gallery-cloudflare-backup"
  backup_region = "us-east-1"
}

# Credentials as provider arguments rather than the AWS_* variables, which the state backend reads as R2's. The tag
# is what groups the resources in the console and the bill, where OpenTofu's state is not visible.
provider "aws" {
  region     = local.backup_region
  access_key = var.aws_access_key_id
  secret_key = var.aws_secret_access_key
  token      = var.aws_session_token == "" ? null : var.aws_session_token
  default_tags {
    tags = { Project = "tacocat-gallery-cloudflare" }
  }
}

module "backup" {
  source = "./backup"
  name   = local.backup_name
  region = local.backup_region
}

# The Backup workflow's BACKUP_TARGET secret.
output "backup_target" {
  value     = module.backup.rclone_target
  sensitive = true
}
