#!/bin/bash
set -e

echo "Waiting for Garage to start..."
sleep 5

echo "Getting node ID..."
NODE_ID=$(docker exec mrp-garage-s3 /garage node id -q | cut -d@ -f1)
echo "Node ID: $NODE_ID"

echo "Configuring layout..."
docker exec mrp-garage-s3 /garage layout assign -z dc1 -c 1G "$NODE_ID"
docker exec mrp-garage-s3 /garage layout apply --version 1

echo "Creating bucket..."
docker exec mrp-garage-s3 /garage bucket create mrp-videos

echo "Creating API key..."
docker exec mrp-garage-s3 /garage key create mrp-app-key

echo "Setting bucket permissions..."
docker exec mrp-garage-s3 /garage bucket allow \
  --read --write --owner \
  mrp-videos \
  --key mrp-app-key

echo ""
echo "=== S3 Credentials ==="
docker exec mrp-garage-s3 /garage key info mrp-app-key --show-secret

echo ""
echo "=== Configuration for .env ==="
echo "S3_ENDPOINT=http://localhost:3900"
echo "S3_BUCKET=mrp-videos"
echo "S3_REGION=garage"
echo ""
echo "Copy the Access Key ID and Secret Key from above to your .env file"
