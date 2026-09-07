-- An EXPLICIT default branch (F8.2 follow-up).
--
-- The service previously resolved "the default branch" as the oldest active
-- one. That looked equivalent and was not: the seeded branch is written by a
-- migration using MySQL's NOW(3), which records the SERVER's local time, while
-- every branch created afterwards comes from Prisma in real UTC. On a machine
-- ahead of UTC the seeded branch sorts AFTER later ones, so stock recorded
-- without an explicit branch silently landed at the wrong place.
--
-- A flag cannot drift with a timezone.
ALTER TABLE `branches` ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT false;

-- Promote the existing seeded branch, or the first one if it was renamed.
UPDATE `branches` SET `is_default` = true WHERE `id` = 'branch_default';

UPDATE `branches`
SET `is_default` = true
WHERE `is_active` = true
  AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM `branches`) b WHERE b.`is_default` = true)
LIMIT 1;
