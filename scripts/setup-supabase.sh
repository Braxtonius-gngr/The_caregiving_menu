#!/usr/bin/env bash
# One-time setup of a hosted Supabase project for The Caregiving Menu.
#
#   scripts/setup-supabase.sh <project-ref>            # do it
#   scripts/setup-supabase.sh <project-ref> --dry-run  # print the steps only
#
# Needs: Node (for npx) and a Supabase login (`npx supabase login`, once).
# Optional env: ANTHROPIC_API_KEY, USDA_API_KEY (asked for if missing / skipped).
set -euo pipefail

REF="${1:-}"
DRY=""
[ "${2:-}" = "--dry-run" ] && DRY=1
if [ -z "$REF" ] || [[ ! "$REF" =~ ^[a-z0-9]{20}$ ]]; then
  echo "usage: scripts/setup-supabase.sh <project-ref> [--dry-run]"
  echo "The project ref is the 20-letter id in your project URL: https://<ref>.supabase.co"
  exit 1
fi
cd "$(dirname "$0")/.."
SB=(npx -y supabase@2.54.11)
run() { echo "+ $*"; [ -n "$DRY" ] || "$@"; }

echo "== 1/4 Link this folder to the project"
run "${SB[@]}" link --project-ref "$REF"

echo "== 2/4 Create the tables, privacy rules and photo bucket (supabase/migrations)"
run "${SB[@]}" db push

echo "== 3/4 Deploy the cloud functions"
run "${SB[@]}" functions deploy brain --project-ref "$REF"
run "${SB[@]}" functions deploy lookup --no-verify-jwt --project-ref "$REF"

echo "== 4/4 Store the API keys as project secrets (never in the app)"
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "$DRY" ]; then
  read -rsp "Anthropic API key (sk-ant-..., leave empty to skip): " ANTHROPIC_API_KEY; echo
fi
if [ -z "${USDA_API_KEY:-}" ] && [ -z "$DRY" ]; then
  read -rp "USDA FoodData Central key (free, optional, leave empty to skip): " USDA_API_KEY
fi
ENVFILE="$(mktemp)"; chmod 600 "$ENVFILE"; trap 'rm -f "$ENVFILE"' EXIT
[ -n "${ANTHROPIC_API_KEY:-}" ] && echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" >> "$ENVFILE"
[ -n "${USDA_API_KEY:-}" ] && echo "USDA_API_KEY=$USDA_API_KEY" >> "$ENVFILE"
if [ -s "$ENVFILE" ] || [ -n "$DRY" ]; then
  run "${SB[@]}" secrets set --env-file "$ENVFILE" --project-ref "$REF"
else
  echo "(no keys given; photo/recipe reading stays off until ANTHROPIC_API_KEY is set)"
fi

cat <<NEXT

Done. Two things left, both in the Supabase dashboard / the app:
  1. Authentication > URL Configuration: set Site URL to where the app is hosted
     (for GitHub Pages: https://<you>.github.io/<repo>/) and add it to Redirect URLs.
  2. Open the app > Settings > Cloud sync and paste:
       Project URL:  https://$REF.supabase.co
       Anon key:     Project Settings > API > "anon public"
     Then sign in, and use "Copy setup link for another device" for everyone else.
NEXT
