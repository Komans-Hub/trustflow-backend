#!/bin/bash
set -e

echo "========================================="
echo "  TrustFlow Backend — Starting up"
echo "========================================="

echo "[1/6] Running migration 001: users..."
psql "$DATABASE_URL" -f migrations/001_create_users.sql
echo "      ✓ Done"

echo "[2/6] Running migration 002: trust_profiles..."
psql "$DATABASE_URL" -f migrations/002_create_trust_profiles.sql
echo "      ✓ Done"

echo "[3/6] Running migration 003: transactions..."
psql "$DATABASE_URL" -f migrations/003_create_transactions.sql
echo "      ✓ Done"

echo "[4/6] Running migration 004: reviews..."
psql "$DATABASE_URL" -f migrations/004_create_reviews.sql
echo "      ✓ Done"

echo "[5/6] All migrations applied successfully."
echo "[6/6] Starting Express server..."
echo "========================================="

node src/index.js
