#!/usr/bin/env bash
# Checks that two nameservers answer identically for every record of the tacocat.com zone in infra/tacocat.tf, so that
# the zone on Cloudflare can be proved a copy of DreamHost's before the nameservers change at GoDaddy, and again just
# before they do. Cloudflare's assigned nameservers answer for the zone before it is delegated, which is what makes
# the check possible ahead of the switch; `tofu output tacocat_name_servers` in infra/ names them.
#
# Every name is asked for every record type the zone uses, not only the type declared for it, so a record present on
# one side alone shows up as well as one that differs. TXT answers are compared as one string, since a server may
# split a long value such as the DKIM key into 255-byte chunks differently. Owner names and targets are compared in
# lower case, TXT values byte for byte.
#
# Usage: scripts/zone-diff.sh <from nameserver> <to nameserver>
#   scripts/zone-diff.sh ns1.dreamhost.com abby.ns.cloudflare.com
#
# Exits 0 when every answer matches, 1 with the differences otherwise, and 2 when a server's answer is not
# authoritative: a home router or ISP that intercepts port 53 answers every query from its own resolver, whichever
# server it was addressed to, which makes the two sides identical whatever the zones hold. The Zone diff workflow
# (.github/workflows/zone-diff.yml) runs this from a GitHub runner, which has no such thing in the way.
set -euo pipefail

if [ $# -ne 2 ]; then
    echo "Usage: $0 <from nameserver> <to nameserver>" >&2
    exit 2
fi
from=$1
to=$2
records=$(dirname "$0")/../infra/tacocat.tf
types="A AAAA CNAME MX TXT CAA"

names() {
    grep -o 'name = "[^"]*"' "$records" | cut -d'"' -f2 | sort -u
}

# Every answer of one nameserver for a name in the zone, as "name type rdata" lines, sorted. DreamHost's servers add
# the records a CNAME's target resolves to, which are another zone's business.
answers() {
    local server=$1
    while read -r name; do
        for type in $types; do
            dig @"$server" "$name" "$type" +noall +answer +norecurse +time=5 +tries=2 |
                awk -v type="$type" '
                    $4 == type && $1 ~ /(^|\.)tacocat\.com\.$/ {
                        name = tolower($1); $1 = $2 = $3 = $4 = ""; sub(/^ +/, "")
                        if (type == "TXT") { gsub(/" "/, ""); print name, type, $0 }
                        else print name, type, tolower($0)
                    }'
        done
    done < <(names) | sort
}

# An authoritative server answers the zone's SOA with the aa flag; a resolver in the way does not.
authoritative() {
    local server=$1
    if ! dig @"$server" tacocat.com SOA +norecurse +time=5 +tries=2 | grep -q '^;; flags:.* aa[ ;]'; then
        echo "$server did not answer authoritatively for tacocat.com; something between here and it answers instead." >&2
        exit 2
    fi
}

authoritative "$from"
authoritative "$to"
count=$(names | wc -l | tr -d ' ')
echo "Comparing $count names, $types, on $from and $to..."
if diff <(answers "$from") <(answers "$to") > >(sed "s/^</< $from:/; s/^>/> $to:/"); then
    echo "Identical."
else
    echo "Different." >&2
    exit 1
fi
