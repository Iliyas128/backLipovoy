import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { connectDatabase, isMongoReady } from "./server/db.js";
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

const seed = [
  { slug:"jacket-core", name:"Куртка", category:"Outerwear", price:42900, color:"Graphite", accent:"#d8fb38", badge:"Drop 01", description:"Плотная уличная куртка с чистым силуэтом, матовой фурнитурой и посадкой поверх худи.", details:"Матовая плащевая ткань, усиленный ворот, свободная посадка под худи.", image:"https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}, sizeMeasures:{M:"11",L:"22",XL:"26","2XL":"22","3XL":"4","4XL":"9"}},
  { slug:"pants-wide", name:"Штаны", category:"Bottoms", price:28900, color:"Ink Black", accent:"#ff4e38", badge:"Best stock", description:"Широкие брюки с мягким падением ткани, карманами и низкой городской посадкой.", details:"Плотный хлопок, глубокие карманы, регулируемый низ.", image:"https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}, sizeMeasures:{S:"38",M:"30",L:"62",XL:"53","2XL":"60","3XL":"23"}},
  { slug:"shorts-utility", name:"Шорты", category:"Archive", price:16900, color:"Washed Black", accent:"#ffcd4d", badge:"Mock", description:"Архивные широкие шорты. Сейчас sold out, но карточка оставлена для вишлиста.", details:"Свободная посадка, хлопок с эффектом washed, утилитарные карманы.", image:"https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"tee-black-over", name:"Футболка Черная Овер", category:"T-Shirts", price:14900, color:"Black", accent:"#5bd7ff", badge:"Essential", description:"Базовая чёрная футболка с тяжёлым хлопком и минимальной маркировкой на груди.", details:"Оверсайз крой, стойкий чёрный цвет, тональная вышивка.", image:"https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"tee-lg-white", name:"Футболка LG белая", category:"T-Shirts", price:14900, color:"Warm White", accent:"#f3e8bf", badge:"Clean fit", description:"Белая футболка с плотным воротом, спокойной графикой и расслабленным оверсайзом.", details:"Тяжёлый хлопок 240 gsm, усиленный ворот, мягкая фактура.", image:"https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}, sizeMeasures:{S:"23",M:"45",L:"39",XL:"38","2XL":"55","3XL":"18"}},
  { slug:"tee-lg-black", name:"Футболка LG черная", category:"T-Shirts", price:14900, color:"Black", accent:"#5bd7ff", badge:"Essential", description:"Базовая чёрная футболка с тяжёлым хлопком и минимальной маркировкой на груди.", details:"Оверсайз крой, стойкий чёрный цвет, тональная вышивка.", image:"https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}, sizeMeasures:{S:"23",M:"41",L:"40",XL:"41"}},
  { slug:"cap-washed", name:"Бейсболка", category:"Archive", price:9900, color:"Washed Black", accent:"#333", badge:"Mock", description:"Кепка с мягкой винтажной стиркой и плотной посадкой.", details:"Хлопок, регулируемая застежка, минимальная вышивка.", image:"https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"polo-a1", name:"Поло А1", category:"Tops", price:17900, color:"Night Navy", accent:"#a78bfa", badge:"New line", description:"Поло с трикотажной фактурой, короткой планкой и аккуратной посадкой.", details:"Мягкий трикотаж, плотная посадка плеча, премиальная фурнитура.", image:"https://images.unsplash.com/photo-1516826957135-700dedea698c?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}, sizeMeasures:{M:"18",L:"30",XL:"40","2XL":"18","3XL":"7"}},
  { slug:"hoodie-heavy-black", name:"Худи Heavy Black", category:"Outerwear", price:24900, color:"Black", accent:"#111", badge:"New", description:"Массивное худи с идеальным кроем и плотным капюшоном.", details:"Тяжёлый футер 500 gsm, двойной капюшон, свободная посадка.", image:"https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"jorts-carpenter-blue", name:"Шорты Carpenter Blue", category:"Bottoms", price:19900, color:"Washed Blue", accent:"#5c7a99", badge:"Trending", description:"Широкие джинсовые шорты с карманными деталями в стиле workwear.", details:"Плотный деним, удлиненный крой ниже колена, винтажная стирка.", image:"https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"jersey-pharos", name:"Джерси Pharos", category:"Tops", price:15900, color:"White Red", accent:"#e53935", badge:"Mock", description:"Легкое джерси с уличной графикой и спортивным вайбом.", details:"Дышащая сетка, свободная посадка, контрастные вставки.", image:"https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"balloon-jeans-black", name:"Джинсы Balloon Black", category:"Bottoms", price:27900, color:"Black", accent:"#1f1f1f", badge:"Mock", description:"Объемные джинсы с низкой посадкой и широким силуэтом.", details:"Плотный деним, мягкая стирка, свободная посадка.", image:"https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"sweatpants-orbit", name:"Штаны Orbit", category:"Bottoms", price:22900, color:"Charcoal", accent:"#777", badge:"Mock", description:"Спортивные штаны с объемным низом и спокойной графикой.", details:"Мягкий футер, регулируемый пояс, свободный крой.", image:"https://images.unsplash.com/photo-1506629905607-d9d297d48b50?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"tank-shadow", name:"Майка Shadow", category:"Tops", price:11900, color:"Gray", accent:"#8b8b8b", badge:"Mock", description:"Минималистичная майка под широкие джинсы и шорты.", details:"Плотный хлопок, глубокая пройма, прямой силуэт.", image:"https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"shirt-boxy-cream", name:"Рубашка Boxy Cream", category:"Tops", price:21900, color:"Cream", accent:"#f2e7d2", badge:"Mock", description:"Бокси-рубашка с плотной посадкой и чистым воротом.", details:"Смесовый хлопок, укороченный силуэт, матовые пуговицы.", image:"https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}},
  { slug:"denim-thunder-wash", name:"Джинсы Thunder Wash", category:"Bottoms", price:29900, color:"Blue Wash", accent:"#6d8fb5", badge:"Mock", description:"Широкий деним с выраженной стиркой и тяжелым низом.", details:"100% хлопок, вареный эффект, свободная посадка.", image:"https://images.unsplash.com/photo-1511196044526-5cb3bcb7071b?auto=format&fit=crop&w=1400&q=88", sizes:{S:8,M:16,L:18,XL:12,"2XL":4,"3XL":0,"4XL":0}}
];

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
const memoryUsers = new Map();

const CATEGORY_CATALOG = {
  Outerwear: "outerwear",
  Bottoms: "bottoms",
  "T-Shirts": "t-shirts",
  Tops: "tops",
  Archive: "archive",
};

const defaultCatalogs = [
  { id: "outerwear", name: "Верхняя одежда", slug: "outerwear" },
  { id: "bottoms", name: "Брюки", slug: "bottoms" },
  { id: "t-shirts", name: "Футболки", slug: "t-shirts" },
  { id: "tops", name: "Верх", slug: "tops" },
  { id: "archive", name: "Архив", slug: "archive" },
];

let memory = structuredClone(seed).map((item) => ({
  ...item,
  catalogs: item.catalogs?.length ? item.catalogs : [CATEGORY_CATALOG[item.category]].filter(Boolean),
}));
let memorySettings = {
  catalogs: defaultCatalogs,
  menu: [
    { label: "ВЕРХНЯЯ ОДЕЖДА", link: "/catalog/outerwear" },
    { label: "БРЮКИ", link: "/catalog/bottoms" },
    { label: "ФУТБОЛКИ", link: "/catalog/t-shirts" },
    { label: "ВЕРХ", link: "/catalog/tops" },
    { label: "АРХИВ", link: "/catalog/archive" },
  ],
  reviewVideos: [],
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

async function seedDatabase() {
  if (!isMongoReady()) return;
  for (const item of seed) {
    const catalogs = [CATEGORY_CATALOG[item.category]].filter(Boolean);
    await Product.findOneAndUpdate({ slug: item.slug }, { $set: { ...item, catalogs } }, { upsert: true });
  }
  const existing = await Setting.findOne();
  if (!existing) {
    await Setting.create(memorySettings);
  } else if (!existing.catalogs?.length) {
    await Setting.findOneAndUpdate({}, { $set: { catalogs: defaultCatalogs } });
  }
}

async function seedAdminUser() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const passwordHash = await hashPassword(password);
  if (isMongoReady()) {
    await User.findOneAndUpdate(
      { email },
      { $set: { email, passwordHash, name: "Admin", role: "admin", cart: [] } },
      { upsert: true },
    );
    console.log(`Admin user ready: ${email}`);
    return;
  }

  const existing = [...memoryUsers.values()].find((u) => u.email === email);
  if (!existing) {
    const id = randomUUID();
    memoryUsers.set(id, { id, email, passwordHash, name: "Admin", role: "admin", cart: [] });
    console.log(`Admin user ready (memory): ${email}`);
  }
}

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
  if (isMongoReady()) return User.findOne({ email: normalized });
  return [...memoryUsers.values()].find((u) => u.email === normalized) || null;
}

async function createUser({ name, email, password }) {
  const normalized = String(email || "").trim().toLowerCase();
  const existing = await findUserByEmail(normalized);
  if (existing) throw new Error("Email already registered");

  const passwordHash = await hashPassword(password);
  const role = isAdminEmail(normalized) ? "admin" : "user";
  const payload = { email: normalized, passwordHash, name: name?.trim() || normalized.split("@")[0], role, cart: [] };

  if (isMongoReady()) {
    return User.create(payload);
  }

  const id = randomUUID();
  const user = { id, ...payload };
  memoryUsers.set(id, user);
  return user;
}

const mongoConnected = await connectDatabase();
if (mongoConnected) {
  for (const item of seed) {
    await Product.findOneAndUpdate({ slug: item.slug }, { $set: item }, { upsert: true });
  }
  if (!await Setting.countDocuments()) {
    await Setting.create(memorySettings);
  }
  try {
    await Product.syncIndexes();
  } catch (e) {
    console.warn("Text index sync:", e.message);
  }
  console.log(s3Enabled ? "AWS S3 uploads enabled" : "AWS S3 not configured — media stays as URLs/base64");
}
await seedAdminUser();

const all = async () => isMongoReady()
  ? (await Product.find().sort({ createdAt: 1 })).map(clean)
  : memory.map(clean);

const getSettings = async () => {
  let settings = memorySettings;
  if (isMongoReady()) {
    const doc = await Setting.findOne();
    settings = doc ? cleanSettings(doc) : memorySettings;
  }
  return {
    ...settings,
    catalogs: settings.catalogs?.length ? settings.catalogs : defaultCatalogs,
    menu: (settings.menu || memorySettings.menu).map((item) => {
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

const attachUser = createAuthMiddleware({ User, memoryUsers, isMongoReady });
app.use(attachUser);

app.get("/api/health", (_q, r) => r.json({
  ok: true,
  database: isMongoReady() ? "mongo" : "memory",
  storage: s3Enabled ? "s3" : "local",
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
    if (isMongoReady()) {
      q.user.cart = items;
      await q.user.save();
    } else {
      q.user.cart = items;
      memoryUsers.set(q.user.id, q.user);
    }
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
    if (isMongoReady()) {
      await Setting.findOneAndUpdate({}, { $set: payload }, { upsert: true, new: true });
    } else {
      memorySettings = { ...memorySettings, ...payload };
    }
    r.json({ ok: true });
  } catch (error) {
    console.error("Settings save failed:", error.message);
    r.status(500).json({ error: error.message });
  }
});

app.post("/api/upload", requireAdmin, async (q, r) => {
  try {
    if (!s3Enabled) {
      return r.status(503).json({ error: "S3 is not configured" });
    }
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
      isMongoReady,
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
  const p = isMongoReady()
    ? await Product.findOne({ slug: q.params.slug })
    : memory.find(x => x.slug === q.params.slug);
  p ? r.json(clean(p)) : r.status(404).json({ error: "Not found" });
});

app.post("/api/products", requireAdmin, async (q, r) => {
  try {
    const raw = await persistProductMedia(q.body);
    const payload = sanitizeProductInput(raw);
    const p = isMongoReady()
      ? await Product.create(payload)
      : (memory.push(payload), payload);
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
    let p;
    if (isMongoReady()) {
      p = await Product.findOneAndUpdate(
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
    } else {
      const i = memory.findIndex((x) => x.slug === q.params.slug || x.slug === payload.slug);
      if (i >= 0) memory[i] = payload;
      else memory.push(payload);
      p = payload;
    }
    if (!p) return r.status(404).json({ error: "Not found" });
    r.json(clean(p));
  } catch (error) {
    console.error("Product update failed:", error.message);
    r.status(500).json({ error: error.message });
  }
});

app.delete("/api/products/:slug", requireAdmin, async (q, r) => {
  if (isMongoReady()) await Product.deleteOne({ slug: q.params.slug });
  else memory = memory.filter(x => x.slug !== q.params.slug);
  r.json({ ok: true });
});

app.post("/api/checkout", async (q, r) => {
  const products = await all();
  const sum = (q.body.items || []).reduce((s, i) => s + (products.find(p => p.slug === i.slug)?.price || 0) * (i.quantity || 1), 0);
  r.json({ status: "reserved", orderId: `NR-${Date.now().toString(36).toUpperCase()}`, total: sum });
});

export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Streetwear API listening on http://localhost:${port}`);
    console.log(`Database: ${isMongoReady() ? "MongoDB" : "memory"}`);
    console.log(`Storage: ${s3Enabled ? "AWS S3" : "not configured"}`);
  });
}
