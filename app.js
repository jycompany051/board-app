const express = require("express");
const session = require("express-session");
const RedisStore = require("connect-redis");
const { createClient } = require("redis");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err);
});

redisClient.connect().catch(console.error);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : false
});

app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || "change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 1000 * 60 * 30
    }
  })
);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

initDb().catch(console.error);

// 메인 화면 = 글 목록
app.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM posts ORDER BY id DESC"
    );

    res.render("index", {
      posts: result.rows,
      admin: req.session.admin || false
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("글 목록을 불러오는 중 오류가 발생했습니다.");
  }
});

// 글쓰기 화면
app.get("/write", (req, res) => {
  res.render("write", {
    admin: req.session.admin || false
  });
});

// 글 등록
app.post("/write", async (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).send("제목과 내용을 입력해주세요.");
    }

    await pool.query(
      "INSERT INTO posts (title, content) VALUES ($1, $2)",
      [title, content]
    );

    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("글 등록 중 오류가 발생했습니다.");
  }
});

// 관리자 로그인 화면
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

// 관리자 로그인 처리
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (username !== process.env.ADMIN_USERNAME) {
      return res.render("login", { error: "아이디가 틀렸습니다." });
    }

    const ok = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

    if (!ok) {
      return res.render("login", { error: "비밀번호가 틀렸습니다." });
    }

    req.session.admin = true;
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("로그인 중 오류가 발생했습니다.");
  }
});

// 관리자 로그아웃
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// 글 삭제
app.post("/delete/:id", async (req, res) => {
  try {
    if (!req.session.admin) {
      return res.status(403).send("관리자만 삭제할 수 있습니다.");
    }

    await pool.query("DELETE FROM posts WHERE id = $1", [req.params.id]);
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("삭제 중 오류가 발생했습니다.");
  }
});

// 비밀번호 변경 화면
app.get("/change-password", (req, res) => {
  if (!req.session.admin) {
    return res.status(403).send("관리자만 접근할 수 있습니다.");
  }

  res.render("change-password", {
    error: null,
    success: null,
    newHash: null
  });
});

// 비밀번호 변경 처리
app.post("/change-password", async (req, res) => {
  try {
    if (!req.session.admin) {
      return res.status(403).send("관리자만 접근할 수 있습니다.");
    }

    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.render("change-password", {
        error: "모든 값을 입력해주세요.",
        success: null,
        newHash: null
      });
    }

    const currentOk = await bcrypt.compare(
      currentPassword,
      process.env.ADMIN_PASSWORD_HASH
    );

    if (!currentOk) {
      return res.render("change-password", {
        error: "현재 비밀번호가 일치하지 않습니다.",
        success: null,
        newHash: null
      });
    }

    if (newPassword !== confirmPassword) {
      return res.render("change-password", {
        error: "새 비밀번호와 확인 비밀번호가 일치하지 않습니다.",
        success: null,
        newHash: null
      });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    return res.render("change-password", {
      error: null,
      success:
        "새 비밀번호 해시가 생성되었습니다. 아래 해시값을 복사해서 Render 환경변수 ADMIN_PASSWORD_HASH에 붙여넣으세요.",
      newHash
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("비밀번호 변경 중 오류가 발생했습니다.");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
