UPDATE `products`
SET `catalogue_version` = 1
WHERE `catalogue_version` = 0;

INSERT INTO `product_catalogue_versions` (
    `id`, `version`, `source`, `summary`, `snapshot`, `actor_id`,
    `actor_email`, `actor_role`, `product_id`, `created_at`
)
SELECT
    CONCAT('baseline-', p.`id`),
    1,
    'CREATE',
    'Initial catalogue baseline',
    JSON_OBJECT(
        'name', p.`name`,
        'sku', p.`sku`,
        'description', p.`description`,
        'price', CAST(p.`price` AS CHAR),
        'cost', IF(p.`cost` IS NULL, NULL, CAST(p.`cost` AS CHAR)),
        'imageUrl', p.`image_url`,
        'status', p.`status`,
        'lowStockThreshold', p.`low_stock_threshold`,
        'storageLocation', p.`storage_location`,
        'categoryId', p.`category_id`,
        'barcode', p.`barcode`,
        'weightKg', IF(p.`weight_kg` IS NULL, NULL, CAST(p.`weight_kg` AS CHAR)),
        'lengthCm', IF(p.`length_cm` IS NULL, NULL, CAST(p.`length_cm` AS CHAR)),
        'widthCm', IF(p.`width_cm` IS NULL, NULL, CAST(p.`width_cm` AS CHAR)),
        'heightCm', IF(p.`height_cm` IS NULL, NULL, CAST(p.`height_cm` AS CHAR)),
        'hsCode', p.`hs_code`,
        'countryOfOrigin', p.`country_of_origin`,
        'slug', p.`slug`,
        'metaTitle', p.`meta_title`,
        'metaDescription', p.`meta_description`,
        'tagIds', COALESCE(
            (SELECT JSON_ARRAYAGG(pt.`B`) FROM `_ProductToTag` pt WHERE pt.`A` = p.`id`),
            JSON_ARRAY()
        ),
        'translations', JSON_ARRAY()
    ),
    NULL,
    NULL,
    NULL,
    p.`id`,
    CURRENT_TIMESTAMP(3)
FROM `products` p
WHERE NOT EXISTS (
    SELECT 1
    FROM `product_catalogue_versions` v
    WHERE v.`product_id` = p.`id`
);
