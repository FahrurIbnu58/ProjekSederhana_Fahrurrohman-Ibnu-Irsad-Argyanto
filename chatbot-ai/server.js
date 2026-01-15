require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req,res)=> res.render("index"));

app.post("/api/chat", async (req,res)=>{
  try{
    const message = (req.body.message || "").toString().trim();
    if(!message) return res.status(400).json({ error: "message kosong" });

    if(!process.env.OPENAI_API_KEY){
      return res.status(500).json({ error: "OPENAI_API_KEY belum di-set di .env" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: "Kamu chatbot sederhana. Jawab singkat dan sopan." },
          { role: "user", content: message }
        ]
      })
    });

    const data = await r.json();
    if(!r.ok) return res.status(400).json({ error: data });

    const reply =
      data.output?.[0]?.content?.[0]?.text ||
      data.output_text ||
      "(Tidak ada output)";

    res.json({ reply });
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, ()=> console.log(`Chatbot running http://localhost:${PORT}`));
