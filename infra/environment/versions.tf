# Without this, a resource moved here from the root would count as changing provider, which the provider refuses.
terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}
