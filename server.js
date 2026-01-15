require("dotenv").config();
console.log("ENV CHECK:", {
  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_PASS: process.env.DB_PASS ? "***" : "",
  DB_NAME: process.env.DB_NAME,
  PORT: process.env.PORT,
});

const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  connectionLimit: 10
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function rupiah(n){ return new Intl.NumberFormat("id-ID").format(n); }

app.get("/", (req,res)=> res.redirect("/admin/purchases"));

// ======================
// LIST PEMBELIAN
// ======================
app.get("/admin/purchases", async (req,res)=>{
  const [rows] = await pool.query("SELECT * FROM purchases ORDER BY id DESC");
  res.render("purchases/index", { purchases: rows, rupiah });
});

// ======================
// FORM INPUT PEMBELIAN
// ======================
app.get("/admin/purchases/new", async (req,res)=>{
  const [products] = await pool.query(`
    SELECT p.id, p.sku, p.name, p.price, s.qty AS stock_qty
    FROM products p JOIN stock s ON s.product_id=p.id
    ORDER BY p.id
  `);
  res.render("purchases/new", { products, rupiah });
});

// ======================
// SIMPAN PEMBELIAN
// ======================
app.post("/admin/purchases", async (req,res)=>{
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const cleanItems = items
    .map(it => ({ product_id: Number(it.product_id), qty: Number(it.qty) }))
    .filter(it => it.product_id > 0 && it.qty > 0);

  if (cleanItems.length === 0) return res.status(400).send("Item kosong.");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const enriched = [];
    for (const it of cleanItems) {
      const [rows] = await conn.query(`
        SELECT p.id, p.name, p.price, s.qty AS stock_qty
        FROM products p JOIN stock s ON s.product_id=p.id
        WHERE p.id=?
      `,[it.product_id]);

      const row = rows[0];
      if (!row) throw new Error("Produk tidak ditemukan.");
      if (row.stock_qty < it.qty) throw new Error(`Stok kurang untuk ${row.name}.`);

      enriched.push({
        product_id: row.id,
        qty: it.qty,
        price: row.price,
        subtotal: row.price * it.qty
      });
    }

    const total = enriched.reduce((a,b)=>a+b.subtotal,0);
    const invoiceNo = `INV-${Date.now()}`;

    const [ins] = await conn.query(
      "INSERT INTO purchases (invoice_no,status,total) VALUES (?, 'ACTIVE', ?)",
      [invoiceNo, total]
    );
    const purchaseId = ins.insertId;

    for (const it of enriched) {
      await conn.query(
        "INSERT INTO purchase_items (purchase_id,product_id,qty,price,subtotal) VALUES (?,?,?,?,?)",
        [purchaseId, it.product_id, it.qty, it.price, it.subtotal]
      );
      await conn.query(
        "UPDATE stock SET qty = qty - ? WHERE product_id=?",
        [it.qty, it.product_id]
      );
    }

    await conn.commit();
    res.redirect(`/admin/purchases/${purchaseId}`);
  } catch(e){
    await conn.rollback();
    res.status(400).send(e.message);
  } finally {
    conn.release();
  }
});

// ======================
// DETAIL PEMBELIAN
// ======================
app.get("/admin/purchases/:id", async (req,res)=>{
  const id = Number(req.params.id);

  const [[purchase]] = await pool.query("SELECT * FROM purchases WHERE id=?", [id]);
  if (!purchase) return res.status(404).send("Not found");

  const [items] = await pool.query(`
    SELECT i.*, p.name, p.sku
    FROM purchase_items i JOIN products p ON p.id=i.product_id
    WHERE i.purchase_id=?
  `,[id]);

  res.render("purchases/show", { purchase, items, rupiah });
});

// ======================
// CANCEL PEMBELIAN
// ======================
app.post("/admin/purchases/:id/cancel", async (req,res)=>{
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try{
    await conn.beginTransaction();

    const [[purchase]] = await conn.query("SELECT * FROM purchases WHERE id=?", [id]);
    if (!purchase) throw new Error("Pembelian tidak ditemukan.");
    if (purchase.status === "CANCELLED") throw new Error("Sudah dibatalkan.");

    const [items] = await conn.query("SELECT product_id, qty FROM purchase_items WHERE purchase_id=?", [id]);
    for (const it of items) {
      await conn.query("UPDATE stock SET qty = qty + ? WHERE product_id=?", [it.qty, it.product_id]);
    }

    await conn.query("UPDATE purchases SET status='CANCELLED' WHERE id=?", [id]);

    await conn.commit();
    res.redirect(`/admin/purchases/${id}`);
  } catch(e){
    await conn.rollback();
    res.status(400).send(e.message);
  } finally {
    conn.release();
  }
});

// ======================
// MARK AS PAID (SUDAH DIBAYAR)
// ======================
app.post("/admin/purchases/:id/pay", async (req, res) => {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[purchase]] = await conn.query("SELECT * FROM purchases WHERE id=?", [id]);
    if (!purchase) throw new Error("Pembelian tidak ditemukan.");
    if (purchase.status === "CANCELLED") throw new Error("Sudah dibatalkan.");
    if (purchase.status === "PAID") throw new Error("Tidak bisa cancel, karena sudah dibayar.");

    await conn.query(
      "UPDATE purchases SET status='PAID', paid_at=NOW() WHERE id=?",
      [id]
    );

    await conn.commit();
    res.redirect(`/admin/purchases/${id}`);
  } catch (e) {
    await conn.rollback();
    res.status(400).send(e.message);
  } finally {
    conn.release();
  }
});

app.listen(PORT, ()=> console.log(`Admin running http://localhost:${PORT}/admin/purchases`));
