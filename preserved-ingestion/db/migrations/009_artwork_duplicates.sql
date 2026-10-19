-- Record same-file provenance without deleting or merging historical assets.
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES media_asset(asset_id);
UPDATE media_asset a SET duplicate_of=(
 SELECT b.asset_id FROM media_asset b
 WHERE b.work_id=a.work_id AND b.image_sha256=a.image_sha256 AND b.asset_id<>a.asset_id
 AND b.created_at<a.created_at ORDER BY b.created_at,b.asset_id LIMIT 1
) WHERE a.image_sha256 IS NOT NULL AND a.duplicate_of IS NULL;
