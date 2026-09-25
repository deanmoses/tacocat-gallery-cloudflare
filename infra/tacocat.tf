# The tacocat.com zone, ahead of moving its nameservers from DreamHost. Every record DreamHost serves today is declared
# here, DNS-only and unchanged, so that the zone answers exactly as DreamHost does before the nameservers change at
# GoDaddy; scripts/zone-diff.sh checks that. Nothing here is live until they do, and Cloudflare deletes a Free zone left
# pending for 28 days, so this is applied again shortly before the switch. Records that point at AWS stay
# DNS-only, since proxying in front of CloudFront would stack two CDNs; the ACM validation CNAMEs keep the AWS
# certificates renewing; the Google records carry the mail, and the DKIM key is the one most easily damaged in a copy.
# Dropping the leftovers is a change for after the move, when a diff against DreamHost no longer matters.
resource "cloudflare_zone" "tacocat" {
  account = { id = local.account_id }
  name    = "tacocat.com"
}

locals {
  tacocat_records = [
    { name = "tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "dev-pix.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "ftp.dev-pix.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "ssh.dev-pix.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "www.dev-pix.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "ftp.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "gallery3.tacocat.com", type = "A", content = "64.90.63.108" },
    { name = "prod-pix.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "ftp.prod-pix.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "ssh.prod-pix.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "www.prod-pix.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "ssh.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "www.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "tacocat.com", type = "MX", content = "ASPMX.L.GOOGLE.com", priority = 1 },
    { name = "tacocat.com", type = "MX", content = "ALT1.ASPMX.L.GOOGLE.com", priority = 5 },
    { name = "tacocat.com", type = "MX", content = "ALT2.ASPMX.L.GOOGLE.com", priority = 5 },
    { name = "tacocat.com", type = "MX", content = "ALT3.ASPMX.L.GOOGLE.com", priority = 10 },
    { name = "tacocat.com", type = "MX", content = "ALT4.ASPMX.L.GOOGLE.com", priority = 10 },
    { name = "tacocat.com", type = "TXT", content = "google-site-verification=En35chboU0PBIeqQIplDlcsFlCzOa-DzCv8VMuqhyR0" },
    { name = "google._domainkey.tacocat.com", type = "TXT", content = "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsh1aXVm2tMG9C5nUVjuf3vkfXKMlTmfZhUFVoVqUAWBf/WZzPlTGk/g2wbBB6tCa6f/zGYAPDstHOlAgakHnv5DxyNjGXDYxlxU21xJeTdl2MiXCHfb708Oj7eXmL6Y+GMWh4Iz5z87znL+rocOKp4g2bvjheqI46RlBSatWoHn27+g719M1qFftCy0jEcDgFs+yhoYbdCcJW9HkDTQ8s3piTgOxRtdp7SqlgsDkQADat4/zTFqCHE2G3txhRTbTDEqXf5wzVhU/ZvizP8Ce8pI4/7EClehUNf/igMc3Zj7iXcCtrwg0aoHgVuJBzoOQUlIsd5vNhjjVQdJYAlRcHwIDAQAB" },
    { name = "calendar.tacocat.com", type = "CNAME", content = "ghs.googlehosted.com" },
    { name = "cdn.tacocat.com", type = "CNAME", content = "ddoyrjpjw6wgp.cloudfront.net" },
    { name = "_26dd347593264ccb1ed03eb66f7cff3f.cdn.tacocat.com", type = "CNAME", content = "_8a17baaf2779fb54d6346854639f3554.dsrmygwdhx.acm-validations.aws" },
    { name = "docs.tacocat.com", type = "CNAME", content = "ghs.googlehosted.com" },
    { name = "login.tacocat.com", type = "CNAME", content = "d1be9xhgy7sojj.cloudfront.net" },
    { name = "_262eb6e48ccbf73c16ce822b415468fb.login.tacocat.com", type = "CNAME", content = "_dfdec7238e68c116d40f4a803d9a1bc5.mhbtsbpdnt.acm-validations.aws" },
    { name = "mail.tacocat.com", type = "CNAME", content = "ghs.googlehosted.com" },
    { name = "pix.tacocat.com", type = "CNAME", content = "d1e0qhrql1yoqo.cloudfront.net" },
    { name = "_b1a5820fc945c5088c062d7252699084.pix.tacocat.com", type = "CNAME", content = "_b39041744b397810c04ea672579e7096.dsrmygwdhx.acm-validations.aws" },
    { name = "api.pix.tacocat.com", type = "CNAME", content = "d-pbw01cw1w4.execute-api.us-east-1.amazonaws.com" },
    { name = "_393638dd6d38bda98192026a4d429bc1.api.pix.tacocat.com", type = "CNAME", content = "_bd208acffa07d0686742504b3d24c312.mhbtsbpdnt.acm-validations.aws" },
    { name = "auth.pix.tacocat.com", type = "CNAME", content = "d-pzj5ol8pj0.execute-api.us-east-1.amazonaws.com" },
    { name = "_60f04a93910b2b667861aca98143a538.auth.pix.tacocat.com", type = "CNAME", content = "_1a539e72bf9a205b49e31133c1907757.smwfzlpyzn.acm-validations.aws" },
    { name = "img.pix.tacocat.com", type = "CNAME", content = "d1vn5u5nd1mlwb.cloudfront.net" },
    { name = "_ba116a8ca29600016f5fb962d2452b67.img.pix.tacocat.com", type = "CNAME", content = "_12cf0d0620fa964c8c708c7bcfcd69b4.mhbtsbpdnt.acm-validations.aws" },
    { name = "sites.tacocat.com", type = "CNAME", content = "ghs.googlehosted.com" },
    { name = "staging-pix.tacocat.com", type = "CNAME", content = "d3s3iwe0cvrijo.cloudfront.net" },
    { name = "_d4b663a1399973ec36aa8234fb007d12.staging-pix.tacocat.com", type = "CNAME", content = "_4ef336fe2208161a29f1b4ba0305037b.fyfbssdptv.acm-validations.aws" },
    { name = "api.staging-pix.tacocat.com", type = "CNAME", content = "d-jvftjepi02.execute-api.us-east-1.amazonaws.com" },
    { name = "_da9360f808f4ea05ce297edf017b4287.api.staging-pix.tacocat.com", type = "CNAME", content = "_a69154e694f22128edbf5e5f6e518aa3.mhbtsbpdnt.acm-validations.aws" },
    { name = "auth.staging-pix.tacocat.com", type = "CNAME", content = "d-59tuy3zvxh.execute-api.us-east-1.amazonaws.com" },
    { name = "_51eeaa06e28636f9299c3f7f7d12eb6c.auth.staging-pix.tacocat.com", type = "CNAME", content = "_e5ed8a368627b9c975d6743e6eb7abe1.mhbtsbpdnt.acm-validations.aws" },
    { name = "img.staging-pix.tacocat.com", type = "CNAME", content = "dacwtfk6o75l6.cloudfront.net" },
    { name = "_e764b92ac0539fb8a1ed00e14e1c464c.img.staging-pix.tacocat.com", type = "CNAME", content = "_2d693fb491fefcfa2a1a507b3e7bfe06.mhbtsbpdnt.acm-validations.aws" },
    { name = "start.tacocat.com", type = "CNAME", content = "ghs.googlehosted.com" },
    { name = "_215f00334a8b217ba0a84a392352057e.test-pix.tacocat.com", type = "CNAME", content = "_ff8c1f4e30232d961d2f918d9b852013.mhbtsbpdnt.acm-validations.aws" },
    { name = "api.test-pix.tacocat.com", type = "CNAME", content = "d-keibszgrn7.execute-api.us-east-1.amazonaws.com" },
    { name = "_4c945f9714d61c18821e1ca6775bf1f4.api.test-pix.tacocat.com", type = "CNAME", content = "_b09ea763374a09d58c819c8fa9e87b4b.mhbtsbpdnt.acm-validations.aws" },
    { name = "_543035c6ef9268eb653c8723f3562690.auth.test-pix.tacocat.com", type = "CNAME", content = "_9312199e3792d150458d5c12bd903fa1.mhbtsbpdnt.acm-validations.aws" },
    { name = "img.test-pix.tacocat.com", type = "CNAME", content = "d3bf7cs9eq5u6r.cloudfront.net" },
    { name = "_9e17adacfa7ce4569b45c764c5d29b3b.img.test-pix.tacocat.com", type = "CNAME", content = "_09d42a662dcbae1fc4f60e4802895a7c.mhbtsbpdnt.acm-validations.aws" },
    { name = "vercel-pix.tacocat.com", type = "CNAME", content = "cname.vercel-dns.com" },
  ]
}

resource "cloudflare_dns_record" "tacocat" {
  for_each = { for record in local.tacocat_records : "${record.name} ${record.type} ${record.content}" => record }
  zone_id  = cloudflare_zone.tacocat.id
  name     = each.value.name
  type     = each.value.type
  # Cloudflare stores a target in lower case, and would otherwise want to change the MX targets, which DreamHost serves in
  # upper case, on every plan. TXT values are data, and the DKIM key's case is part of it.
  content  = each.value.type == "TXT" ? each.value.content : lower(each.value.content)
  priority = lookup(each.value, "priority", null)
  proxied  = false
  # DreamHost serves every record with a 60 s TTL.
  ttl = 60
}

output "tacocat_name_servers" {
  value = cloudflare_zone.tacocat.name_servers
}
