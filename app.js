const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static("public"));

app.use(session({
  secret: "secret",
  resave: false,
  saveUninitialized: false
}));

app.set("view engine", "ejs");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect("/login");
  next();
}

// DB 생성
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT,
      content_html TEXT,
      author_name TEXT,
      password_hash TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER,
      content TEXT,
      author_name TEXT,
      parent_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
})();

// 목록
app.get("/", async (req, res) => {
  const result = await pool.query("SELECT * FROM posts ORDER BY id DESC");

  res.render("index", {
    posts: result.rows,
    admin: req.session.admin || false
  });
});

// 글쓰기
app.get("/write", (req, res) => {
  res.render("write", { admin: req.session.admin });
});

app.post("/write", async (req, res) => {
  const { title, content, author, password } = req.body;

  const hash = password ? await bcrypt.hash(password, 10) : null;

  await pool.query(
    `INSERT INTO posts (title, content_html, author_name, password_hash)
     VALUES ($1,$2,$3,$4)`,
    [
      title,
      content,
      req.session.admin ? "관리자" : author,
      req.session.admin ? null : hash
    ]
  );

  res.redirect("/");
});

// 상세
app.get("/post/:id", async (req, res) => {
  const post = await pool.query("SELECT * FROM posts WHERE id=$1", [req.params.id]);

  const comments = await pool.query(
    `SELECT * FROM comments WHERE post_id=$1
     ORDER BY COALESCE(parent_id,id), parent_id NULLS FIRST, id`,
    [req.params.id]
  );

  const root = comments.rows.filter(c => !c.parent_id);
  const replies = comments.rows.filter(c => c.parent_id);

  const map = new Map();
  replies.forEach(r => {
    if (!map.has(r.parent_id)) map.set(r.parent_id, []);
    map.get(r.parent_id).push(r);
  });

  res.render("show", {
    post: post.rows[0],
    comments: root,
    replyMap: map,
    admin: req.session.admin || false
  });
});

// 댓글
app.post("/comment/:id", requireAdmin, async (req, res) => {
  await pool.query(
    `INSERT INTO comments (post_id, content, author_name)
     VALUES ($1,$2,'관리자')`,
    [req.params.id, req.body.content]
  );

  res.redirect(`/post/${req.params.id}`);
});

// 답글
app.post("/reply/:postId/:commentId", requireAdmin, async (req, res) => {
  await pool.query(
    `INSERT INTO comments (post_id, content, author_name, parent_id)
     VALUES ($1,$2,'관리자',$3)`,
    [req.params.postId, req.body.content, req.params.commentId]
  );

  res.redirect(`/post/${req.params.postId}`);
});

// 로그인
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  if (req.body.username === "admin" && req.body.password === "1234") {
    req.session.admin = true;
    return res.redirect("/");
  }
  res.send("로그인 실패");
});

// 로그아웃
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// 창 닫기 로그아웃
app.post("/logout-beacon", (req, res) => {
  req.session.destroy(() => res.sendStatus(200));
});

app.listen(10000, () => console.log("서버 실행"));
