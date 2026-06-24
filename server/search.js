import Fuse from "fuse.js";

const fuseOptions = {
  keys: [
    { name: "name", weight: 0.45 },
    { name: "category", weight: 0.2 },
    { name: "description", weight: 0.15 },
    { name: "slug", weight: 0.1 },
    { name: "badge", weight: 0.1 },
  ],
  threshold: 0.38,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

export function fuzzySearchProducts(products, query, limit = 12) {
  const q = String(query || "").trim();
  if (!q) return [];

  const fuse = new Fuse(products, fuseOptions);
  return fuse.search(q, { limit }).map((hit) => hit.item);
}

export async function mongoTextSearch(Product, query, limit = 12) {
  const q = String(query || "").trim();
  if (!q || !Product?.find) return [];

  try {
    const docs = await Product.find(
      { $text: { $search: q } },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit * 2)
      .lean();

    return docs;
  } catch {
    return [];
  }
}

export async function searchProducts({ products, Product, query, clean, isMongoReady, limit = 12 }) {
  const q = String(query || "").trim();
  if (!q) return [];

  let mongoHits = [];
  if (isMongoReady()) {
    mongoHits = await mongoTextSearch(Product, q, limit);
  }

  const fuzzyHits = fuzzySearchProducts(products, q, limit * 2);
  const merged = new Map();

  [...mongoHits.map(clean), ...fuzzyHits].forEach((item) => {
    if (item?.slug) merged.set(item.slug, item);
  });

  return [...merged.values()].slice(0, limit);
}
