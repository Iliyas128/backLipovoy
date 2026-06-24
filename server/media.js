import { persistValue } from "./s3.js";

export async function persistProductMedia(product = {}) {
  const next = { ...product };

  next.image = await persistValue(next.image, "products");
  next.image2 = await persistValue(next.image2, "products");

  if (Array.isArray(next.images)) {
    next.images = await Promise.all(
      next.images.map((img) => persistValue(img, "products")),
    );
  }

  return next;
}

export async function persistSettingsMedia(settings = {}) {
  const next = { ...settings };

  if (Array.isArray(next.reviewVideos)) {
    next.reviewVideos = await Promise.all(
      next.reviewVideos.map(async (item) => ({
        ...item,
        video: await persistValue(item.video, "reviews"),
      })),
    );
  }

  return next;
}
