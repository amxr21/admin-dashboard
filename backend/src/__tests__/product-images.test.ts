import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * A product's image gallery — a real ordered model, not a JSON array. The
 * property worth pinning: reorder REPLACES the whole order atomically (a
 * partial or malformed list is refused outright, never partially applied),
 * and `Product.imageUrl` (the cover image) is untouched by any of this.
 */

const app = createApp();

interface ImageBody {
  data: { image: { id: string; url: string; alt: string | null; position: number } };
}
interface ImagesListBody {
  data: { images: { id: string; url: string; alt: string | null; position: number }[] };
}

const RUN = `imgtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const productIds: string[] = [];
let ownerToken = '';
let supportToken = '';

async function makeUser(role: StaffRole) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${role.toLowerCase()}@example.test`,
      name: role,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return signToken(user);
}

async function makeProduct() {
  const product = await prisma.product.create({
    data: { name: `${RUN} product`, price: new Prisma.Decimal('9.99'), imageUrl: 'https://cdn.example.com/cover.png' },
  });
  productIds.push(product.id);
  return product.id;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  [ownerToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('authorisation', () => {
  it('rejects an unauthenticated request', async () => {
    const productId = await makeProduct();
    const res = await request(app).get(`/api/v1/products/${productId}/images`);
    expect(res.status).toBe(401);
  });

  it('denies a role without the products area', async () => {
    const productId = await makeProduct();
    const res = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(supportToken))
      .send({ url: 'https://cdn.example.com/a.png' });
    expect(res.status).toBe(403);
  });
});

describe('adding images', () => {
  it('appends to the end of the existing order', async () => {
    const productId = await makeProduct();

    const first = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(ownerToken))
      .send({ url: 'https://cdn.example.com/1.png' });
    const second = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(ownerToken))
      .send({ url: 'https://cdn.example.com/2.png' });

    expect((first.body as ImageBody).data.image.position).toBe(0);
    expect((second.body as ImageBody).data.image.position).toBe(1);
  });

  it('never touches the product cover image', async () => {
    const productId = await makeProduct();

    await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(ownerToken))
      .send({ url: 'https://cdn.example.com/gallery.png' });

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.imageUrl).toBe('https://cdn.example.com/cover.png');
  });

  it('rejects a malformed URL', async () => {
    const productId = await makeProduct();
    const res = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(ownerToken))
      .send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown product', async () => {
    const res = await request(app)
      .post('/api/v1/products/does-not-exist/images')
      .set(auth(ownerToken))
      .send({ url: 'https://cdn.example.com/a.png' });
    expect(res.status).toBe(404);
  });

  it('accepts alt text at creation', async () => {
    const productId = await makeProduct();
    const res = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(ownerToken))
      .send({ url: 'https://cdn.example.com/a.png', alt: 'A ceramic planter on a shelf' });

    expect((res.body as ImageBody).data.image.alt).toBe('A ceramic planter on a shelf');
  });

  it('leaves alt text null when omitted, not an empty string', async () => {
    // Null and "" are different states — see the schema comment on
    // ProductImage.alt. Omitting the field entirely must produce the
    // "nobody wrote it" state, not a silently-defaulted empty string.
    const productId = await makeProduct();
    const res = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(ownerToken))
      .send({ url: 'https://cdn.example.com/a.png' });

    expect((res.body as ImageBody).data.image.alt).toBeNull();
  });

  it('rejects alt text past the length cap', async () => {
    const productId = await makeProduct();
    const res = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(ownerToken))
      .send({ url: 'https://cdn.example.com/a.png', alt: 'x'.repeat(161) });

    expect(res.status).toBe(400);
  });
});

describe('editing alt text', () => {
  async function seedOne(productId: string) {
    const res = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(ownerToken))
      .send({ url: 'https://cdn.example.com/a.png' });
    return (res.body as ImageBody).data.image.id;
  }

  it('sets alt text on an existing image, leaving url and position untouched', async () => {
    const productId = await makeProduct();
    const imageId = await seedOne(productId);

    const res = await request(app)
      .patch(`/api/v1/images/${imageId}`)
      .set(auth(ownerToken))
      .send({ alt: 'A wicker basket, empty' });

    expect(res.status).toBe(200);
    expect((res.body as ImageBody).data.image.alt).toBe('A wicker basket, empty');

    const stored = await prisma.productImage.findUnique({ where: { id: imageId } });
    expect(stored?.url).toBe('https://cdn.example.com/a.png');
    expect(stored?.position).toBe(0);
  });

  it('clears alt text back to null', async () => {
    const productId = await makeProduct();
    const imageId = await seedOne(productId);
    await request(app)
      .patch(`/api/v1/images/${imageId}`)
      .set(auth(ownerToken))
      .send({ alt: 'Temporary description' });

    const res = await request(app)
      .patch(`/api/v1/images/${imageId}`)
      .set(auth(ownerToken))
      .send({ alt: null });

    expect((res.body as ImageBody).data.image.alt).toBeNull();
  });

  it('404s for an unknown image', async () => {
    const res = await request(app)
      .patch('/api/v1/images/does-not-exist')
      .set(auth(ownerToken))
      .send({ alt: 'Anything' });
    expect(res.status).toBe(404);
  });

  it('denies a role without the products area', async () => {
    const productId = await makeProduct();
    const imageId = await seedOne(productId);

    const res = await request(app)
      .patch(`/api/v1/images/${imageId}`)
      .set(auth(supportToken))
      .send({ alt: 'Anything' });
    expect(res.status).toBe(403);
  });
});

describe('reordering', () => {
  async function seedThree(productId: string) {
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const res = await request(app)
        .post(`/api/v1/products/${productId}/images`)
        .set(auth(ownerToken))
        .send({ url: `https://cdn.example.com/${String(index)}.png` });
      ids.push((res.body as ImageBody).data.image.id);
    }
    return ids;
  }

  it('replaces the whole order atomically', async () => {
    const productId = await makeProduct();
    const [a, b, c] = await seedThree(productId);

    const res = await request(app)
      .put(`/api/v1/products/${productId}/images/order`)
      .set(auth(ownerToken))
      .send({ ids: [c, a, b] });

    expect(res.status).toBe(200);
    const images = (res.body as ImagesListBody).data.images;
    expect(images.map((image) => image.id)).toEqual([c, a, b]);
    expect(images.map((image) => image.position)).toEqual([0, 1, 2]);
  });

  it('refuses a list missing one of the product\'s images', async () => {
    const productId = await makeProduct();
    const [a] = await seedThree(productId);

    const res = await request(app)
      .put(`/api/v1/products/${productId}/images/order`)
      .set(auth(ownerToken))
      .send({ ids: [a] });

    expect(res.status).toBe(400);
  });

  it('refuses a list naming an image from a different product', async () => {
    const productId = await makeProduct();
    const otherProductId = await makeProduct();
    const [a, b] = await seedThree(productId);
    const [foreign] = await seedThree(otherProductId);

    const res = await request(app)
      .put(`/api/v1/products/${productId}/images/order`)
      .set(auth(ownerToken))
      .send({ ids: [a, b, foreign] });

    expect(res.status).toBe(400);
  });

  it('refuses a list with a duplicate id', async () => {
    const productId = await makeProduct();
    const [a, b, c] = await seedThree(productId);

    const res = await request(app)
      .put(`/api/v1/products/${productId}/images/order`)
      .set(auth(ownerToken))
      .send({ ids: [a, a, c] });

    expect(res.status).toBe(400);
    // Nothing applied — b's original position is untouched.
    const stored = await prisma.productImage.findUnique({ where: { id: b } });
    expect(stored?.position).toBe(1);
  });
});

describe('deleting', () => {
  it('removes an image', async () => {
    const productId = await makeProduct();
    const created = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(auth(ownerToken))
      .send({ url: 'https://cdn.example.com/gone.png' });
    const imageId = (created.body as ImageBody).data.image.id;

    const res = await request(app).delete(`/api/v1/images/${imageId}`).set(auth(ownerToken));
    expect(res.status).toBe(204);
    expect(await prisma.productImage.findUnique({ where: { id: imageId } })).toBeNull();
  });

  it('404s for an unknown image', async () => {
    const res = await request(app).delete('/api/v1/images/does-not-exist').set(auth(ownerToken));
    expect(res.status).toBe(404);
  });
});
