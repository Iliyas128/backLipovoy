import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import { connectDatabase } from "./server/db.js";
import { persistProductMedia, persistSettingsMedia } from "./server/media.js";
import { s3Enabled, uploadBuffer } from "./server/s3.js";
import {
  cleanUser,
  createAuthMiddleware,
  hashPassword,
  isAdminEmail,
  requireAdmin,
  requireAuth,
  signToken,
  verifyPassword,
} from "./server/auth.js";
import { searchProducts } from "./server/search.js";
import { validateLoginInput, validateRegisterInput } from "./server/validate.js";

const app = express();
const port = process.env.PORT || 4000;
app.use(express.json({ limit: "50mb" }));

const frontendOrigins = (process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:5174")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (frontendOrigins.includes(origin) || frontendOrigins.includes("*"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const schema = new mongoose.Schema({
  slug:{type:String,unique:true},name:String,category:String,catalogs:[String],price:Number,color:String,accent:String,badge:String,
  isHit:{type:Boolean,default:false},isNewArrival:{type:Boolean,default:false},
  description:String,details:String,image:String,image2:String,images:[String],sizeMeasures:Object,sizes:Object
},{timestamps:true});
schema.index({ name: "text", description: "text", category: "text", slug: "text", badge: "text" });
const Product = mongoose.models.Product || mongoose.model("Product", schema);
const settingSchema = new mongoose.Schema({ menu: Array, catalogs: Array, reviewVideos: Array }, { timestamps: true });
const Setting = mongoose.models.Setting || mongoose.model("Setting", settingSchema);

const cartItemSchema = new mongoose.Schema({
  key: String,
  slug: String,
  size: String,
  qty: Number,
  name: String,
  price: Number,
  image: String,
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, lowercase: true, trim: true },
  passwordHash: String,
  name: String,
  role: { type: String, enum: ["user", "admin"], default: "user" },
  cart: [cartItemSchema],
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model("User", userSchema);

const CATEGORY_CATALOG = {
  Outerwear: "outerwear",
  Bottoms: "bottoms",
  "T-Shirts": "t-shirts",
  Tops: "tops",
  Archive: "archive",
};

const total = p => Object.values(p.sizes || {}).reduce((s,n)=>s+Number(n||0),0);

function sanitizeProductInput(body = {}) {
  const catalogs = Array.isArray(body.catalogs)
    ? [...new Set(body.catalogs.map((s) => String(s).trim()).filter(Boolean))]
    : [];
  const images = Array.isArray(body.images) ? body.images.filter(Boolean) : [];
  return {
    slug: String(body.slug || "").trim(),
    name: String(body.name || "").trim(),
    category: String(body.category || "").trim(),
    catalogs,
    price: Number(body.price) || 0,
    color: body.color || "",
    accent: body.accent || "",
    badge: body.badge || "",
    isHit: Boolean(body.isHit),
    isNewArrival: Boolean(body.isNewArrival),
    description: body.description || "",
    details: body.details || "",
    image: body.image || images[0] || "",
    image2: body.image2 || images[1] || "",
    images,
    sizeMeasures: body.sizeMeasures || {},
    sizes: body.sizes || {},
  };
}

const clean = p => {
  const x = p?.toObject ? p.toObject() : { ...p };
  if (!x) return null;
  const images = x.images?.length ? x.images.filter(Boolean) : [x.image, x.image2].filter(Boolean);
  if (!x.image && images[0]) x.image = images[0];
  if (!x.image2 && images[1]) x.image2 = images[1];
  const catalogs = x.catalogs?.length ? x.catalogs.filter(Boolean) : [CATEGORY_CATALOG[x.category]].filter(Boolean);
  return { ...x, id: x._id?.toString?.() || x.slug, images, catalogs, total: total(x) };
};

const cleanSettings = (doc) => {
  const x = doc?.toObject ? doc.toObject() : { ...doc };
  delete x._id;
  delete x.__v;
  delete x.createdAt;
  delete x.updatedAt;
  return x;
};

async function seedAdminUser() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const passwordHash = await hashPassword(password);
  await User.findOneAndUpdate(
    { email },
    { $set: { email, passwordHash, name: "Admin", role: "admin", cart: [] } },
    { upsert: true },
  );
  console.log(`Admin user ready: ${email}`);
}

const mongoConnected = await connectDatabase();
if (!mongoConnected) {
  console.error("Failed to connect to MongoDB — exiting");
  process.exit(1);
}

if (!s3Enabled) {
  console.error("AWS S3 is required (AWS_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)");
  process.exit(1);
}

try {
  await Product.syncIndexes();
} catch (e) {
  console.warn("Text index sync:", e.message);
}

await seedAdminUser();
console.log("AWS S3 uploads enabled");

const all = async () => (await Product.find().sort({ createdAt: 1 })).map(clean);

const getSettings = async () => {
  const doc = await Setting.findOne();
  const settings = doc ? cleanSettings(doc) : { catalogs: [], menu: [], reviewVideos: [] };
  return {
    ...settings,
    menu: (settings.menu || []).map((item) => {
      const link = item.link || "";
      if (!link.includes("?")) return item;
      try {
        const url = new URL(link, "http://localhost");
        const category = url.searchParams.get("category") || url.searchParams.get("catalog");
        if (!category) return item;
        const slugMap = { Outerwear: "outerwear", Bottoms: "bottoms", "T-Shirts": "t-shirts", Tops: "tops", Archive: "archive" };
        const slug = slugMap[category] || category.toLowerCase();
        return { ...item, link: `/catalog/${slug}` };
      } catch {
        return item;
      }
    }),
  };
};

const attachUser = createAuthMiddleware({ User });
app.use(attachUser);

app.get("/api/health", (_q, r) => r.json({
  ok: true,
  database: "mongo",
  storage: "s3",
}));

app.post("/api/auth/register", async (q, r) => {
  try {
    const { name, email, password } = q.body || {};
    const inputError = validateRegisterInput({ name, email, password });
    if (inputError) return r.status(400).json({ error: inputError });

    const user = await createUser({ name, email, password });
    r.status(201).json({ token: signToken(user), user: cleanUser(user) });
  } catch (error) {
    r.status(400).json({ error: error.message });
  }
});

app.post("/api/auth/login", async (q, r) => {
  try {
    const { email, password } = q.body || {};
    const inputError = validateLoginInput({ email, password });
    if (inputError) return r.status(400).json({ error: inputError });

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return r.status(401).json({ error: "Invalid email or password" });
    }
    r.json({ token: signToken(user), user: cleanUser(user) });
  } catch (error) {
    r.status(500).json({ error: error.message });
  }
});

app.get("/api/auth/me", requireAuth, (q, r) => {
  r.json({ user: cleanUser(q.user) });
});

app.get("/api/cart", requireAuth, (q, r) => {
  r.json({ items: sanitizeCart(q.user.cart) });
});

app.put("/api/cart", requireAuth, async (q, r) => {
  try {
    const items = sanitizeCart(q.body?.items);
    q.user.cart = items;
    await q.user.save();
    r.json({ items });
  } catch (error) {
    r.status(500).json({ error: error.message });
  }
});

app.get("/api/settings", async (_q, r) => {
  r.json(await getSettings());
});

app.post("/api/settings", requireAdmin, async (q, r) => {
  try {
    const payload = await persistSettingsMedia(q.body);
    await Setting.findOneAndUpdate({}, { $set: payload }, { upsert: true, new: true });
    r.json({ ok: true });
  } catch (error) {
    console.error("Settings save failed:", error.message);
    r.status(500).json({ error: error.message });
  }
});

app.post("/api/upload", requireAdmin, async (q, r) => {
  try {
    const { dataUrl, folder = "uploads" } = q.body || {};
    if (!dataUrl?.startsWith("data:")) {
      return r.status(400).json({ error: "dataUrl is required" });
    }
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return r.status(400).json({ error: "Invalid dataUrl" });
    const [, mime, base64] = match;
    const url = await uploadBuffer(Buffer.from(base64, "base64"), mime, folder);
    r.json({ url });
  } catch (error) {
    console.error("Upload failed:", error.message);
    r.status(500).json({ error: error.message });
  }
});

app.get("/api/products/search", async (q, r) => {
  try {
    const items = await searchProducts({
      products: await all(),
      Product,
      query: q.query.q,
      clean,
      limit: 12,
    });
    r.json(items);
  } catch (error) {
    console.error("Search failed:", error.message);
    r.status(500).json({ error: error.message });
  }
});

app.get("/api/products", async (_q, r) => r.json(await all()));

app.get("/api/products/:slug", async (q, r) => {
  const p = await Product.findOne({ slug: q.params.slug });
  p ? r.json(clean(p)) : r.status(404).json({ error: "Not found" });
});

app.post("/api/products", requireAdmin, async (q, r) => {
  try {
    const raw = await persistProductMedia(q.body);
    const payload = sanitizeProductInput(raw);
    const p = await Product.create(payload);
    r.status(201).json(clean(p));
  } catch (error) {
    console.error("Product create failed:", error.message);
    r.status(500).json({ error: error.message });
  }
});

app.put("/api/products/:slug", requireAdmin, async (q, r) => {
  try {
    const raw = await persistProductMedia(q.body);
    const payload = sanitizeProductInput(raw);
    let p = await Product.findOneAndUpdate(
      { slug: q.params.slug },
      { $set: payload },
      { new: true },
    );
    if (!p && payload.slug !== q.params.slug) {
      p = await Product.findOneAndUpdate(
        { slug: payload.slug },
        { $set: payload },
        { new: true },
      );
    }
    if (!p) return r.status(404).json({ error: "Not found" });
    r.json(clean(p));
  } catch (error) {
    console.error("Product update failed:", error.message);
    r.status(500).json({ error: error.message });
  }
});

app.delete("/api/products/:slug", requireAdmin, async (q, r) => {
  await Product.deleteOne({ slug: q.params.slug });
  r.json({ ok: true });
});

app.post("/api/checkout", async (q, r) => {
  const products = await all();
  const sum = (q.body.items || []).reduce((s, i) => s + (products.find(p => p.slug === i.slug)?.price || 0) * (i.quantity || 1), 0);
  r.json({ status: "reserved", orderId: `NR-${Date.now().toString(36).toUpperCase()}`, total: sum });
});

function sanitizeCart(items = []) {
  return (items || [])
    .filter((x) => x?.slug && x?.size)
    .map((x) => ({
      key: x.key || `${x.slug}-${x.size}`,
      slug: x.slug,
      size: x.size,
      qty: Math.max(1, Number(x.qty) || 1),
      name: x.name || "",
      price: Number(x.price) || 0,
      image: x.image || "",
    }));
}

async function findUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return User.findOne({ email: normalized });
}

async function createUser({ name, email, password }) {
  const normalized = String(email || "").trim().toLowerCase();
  const existing = await findUserByEmail(normalized);
  if (existing) throw new Error("Email already registered");

  const passwordHash = await hashPassword(password);
  const role = isAdminEmail(normalized) ? "admin" : "user";
  return User.create({
    email: normalized,
    passwordHash,
    name: name?.trim() || normalized.split("@")[0],
    role,
    cart: [],
  });
}

export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Streetwear API listening on http://localhost:${port}`);
    console.log("Database: MongoDB");
    console.log("Storage: AWS S3");
  });
}
