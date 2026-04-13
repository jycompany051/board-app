const express = require("express");
const session = require("express-session");
const { RedisStore } = require("connect-redis");
const { createClient } = require("redis");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));
app.use("/public", express.static(path.join(__dirname, "public")));

const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err);
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : false
});

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(403).send("관리자만 접근할 수 있습니다.");
  }
  next();
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT,
      content TEXT,
      content_html TEXT,
      author_name TEXT,
      edit_password_hash TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '관리자',
      parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS title TEXT`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS content TEXT`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_html TEXT`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS author_name TEXT`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS edit_password_hash TEXT`);

  await pool.query(`
    UPDATE posts
    SET title = COALESCE(NULLIF(title, ''), '제목 없음')
    WHERE title IS NULL
  `);

  await pool.query(`
    UPDATE posts
    SET content = COALESCE(content, '')
    WHERE content IS NULL
  `);

  await pool.query(`
    UPDATE posts
    SET content_html = COALESCE(content_html, content, '')
    WHERE content_html IS NULL
  `);

  await pool.query(`
    UPDATE posts
    SET author_name = COALESCE(NULLIF(author_name, ''), '익명')
    WHERE author_name IS NULL
  `);

  const adminCheck = await pool.query(
    "SELECT * FROM admins WHERE username = $1",
    ["admin"]
  );

  if (adminCheck.rows.length === 0) {
    const defaultHash = await bcrypt.hash("1234", 10);
    await pool.query(
      "INSERT INTO admins (username, password_hash) VALUES ($1, $2)",
      ["admin", defaultHash]
    );
    console.log("기본 관리자 계정 생성 완료: admin / 1234");
  }
}

async function startServer() {
  await redisClient.connect();
  await initDb();

  app.use(
    session({
      store: new RedisStore({ client: redisClient }),
      secret: process.env.SESSION_SECRET || "change-this-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7
      }
    })
  );

  app.get("/", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          p.id,
          p.title,
          p.author_name,
          p.created_at,
          COUNT(c.id)::int AS comment_count
        FROM posts p
        LEFT JOIN comments c ON c.post_id = p.id
        GROUP BY p.id
        ORDER BY p.id DESC
      `);

      res.render("index", {
        posts: result.rows,
        admin: req.session.admin || false
      });
    } catch (err) {
      console.error("글 목록 오류:", err);
      res.status(500).send("글 목록을 불러오는 중 오류가 발생했습니다.");
    }
  });

  app.get("/post/:id", async (req, res) => {
    try {
      const postResult = await pool.query(
        "SELECT * FROM posts WHERE id = $1",
        [req.params.id]
      );

      if (postResult.rows.length === 0) {
        return res.status(404).send("게시글을 찾을 수 없습니다.");
      }

      const commentsResult = await pool.query(
        `SELECT * FROM comments
         WHERE post_id = $1
         ORDER BY COALESCE(parent_id, id), parent_id NULLS FIRST, id ASC`,
        [req.params.id]
      );

      const comments = commentsResult.rows.filter((c) => !c.parent_id);
      const replies = commentsResult.rows.filter((c) => c.parent_id);

      const replyMap = new Map();
      for (const reply of replies) {
        if (!replyMap.has(reply.parent_id)) {
          replyMap.set(reply.parent_id, []);
        }
        replyMap.get(reply.parent_id).push(reply);
      }

      res.render("show", {
        post: postResult.rows[0],
        comments,
        replyMap,
        admin: req.session.admin || false
      });
    } catch (err) {
      console.error("상세 보기 오류:", err);
      res.status(500).send("게시글을 불러오는 중 오류가 발생했습니다.");
    }
  });

  app.get("/write", (req, res) => {
    res.render("write", {
      admin: req.session.admin || false,
      error: null
    });
  });

  app.post("/write", async (req, res) => {
    try {
      const { title, content, author_name, edit_password } = req.body;

      const safeTitle = String(title || "").trim();
      const safeContentHtml = String(content || "").trim();

      if (!safeTitle || !safeContentHtml) {
        return res.render("write", {
          admin: req.session.admin || false,
          error: "제목과 내용을 모두 입력해주세요."
        });
      }

      const safeAuthor = req.session.admin
        ? "관리자"
        : (author_name && String(author_name).trim() ? String(author_name).trim() : "익명");

      let passwordHash = null;

      if (!req.session.admin) {
        const safePassword = String(edit_password || "").trim();

        if (!safePassword) {
          return res.render("write", {
            admin: req.session.admin || false,
            error: "수정 비밀번호를 입력해주세요."
          });
        }

        passwordHash = await bcrypt.hash(safePassword, 10);
      }

      const plainTextContent = stripHtml(safeContentHtml);

      await pool.query(
        `INSERT INTO posts (title, content, content_html, author_name, edit_password_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [safeTitle, plainTextContent, safeContentHtml, safeAuthor, passwordHash]
      );

      res.redirect("/");
    } catch (err) {
      console.error("글 등록 오류:", err);
      res.render("write", {
        admin: req.session.admin || false,
        error: "글 등록 중 오류가 발생했습니다."
      });
    }
  });

  app.get("/edit/:id", async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM posts WHERE id = $1",
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).send("게시글을 찾을 수 없습니다.");
      }

      res.render("edit", {
        post: result.rows[0],
        admin: req.session.admin || false,
        error: null
      });
    } catch (err) {
      console.error("글 수정 화면 오류:", err);
      res.status(500).send("수정 화면을 불러오는 중 오류가 발생했습니다.");
    }
  });

  app.post("/edit/:id", async (req, res) => {
    try {
      const { title, content, author_name, edit_password } = req.body;

      const result = await pool.query(
        "SELECT * FROM posts WHERE id = $1",
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).send("게시글을 찾을 수 없습니다.");
      }

      const post = result.rows[0];

      const safeTitle = String(title || "").trim();
      const safeContentHtml = String(content || "").trim();

      if (!safeTitle || !safeContentHtml) {
        return res.render("edit", {
          post,
          admin: req.session.admin || false,
          error: "제목과 내용을 입력해주세요."
        });
      }

      const safeAuthor = req.session.admin
        ? "관리자"
        : (author_name && String(author_name).trim() ? String(author_name).trim() : "익명");

      if (!req.session.admin) {
        const safePassword = String(edit_password || "").trim();

        if (!safePassword) {
          return res.render("edit", {
            post,
            admin: req.session.admin || false,
            error: "수정 비밀번호를 입력해주세요."
          });
        }

        const ok = await bcrypt.compare(
          safePassword,
          post.edit_password_hash || ""
        );

        if (!ok) {
          return res.render("edit", {
            post,
            admin: req.session.admin || false,
            error: "수정 비밀번호가 올바르지 않습니다."
          });
        }
      }

      const plainTextContent = stripHtml(safeContentHtml);

      await pool.query(
        `UPDATE posts
         SET title = $1, content = $2, content_html = $3, author_name = $4
         WHERE id = $5`,
        [safeTitle, plainTextContent, safeContentHtml, safeAuthor, req.params.id]
      );

      res.redirect(`/post/${req.params.id}`);
    } catch (err) {
      console.error("글 수정 오류:", err);
      res.status(500).send("글 수정 중 오류가 발생했습니다.");
    }
  });

  app.get("/login", (req, res) => {
    res.render("login", { error: null });
  });

  app.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.render("login", {
          error: "아이디와 비밀번호를 입력해주세요."
        });
      }

      const result = await pool.query(
        "SELECT * FROM admins WHERE username = $1",
        [username]
      );

      if (result.rows.length === 0) {
        return res.render("login", {
          error: "아이디가 틀렸습니다."
        });
      }

      const adminUser = result.rows[0];
      const ok = await bcrypt.compare(password, adminUser.password_hash);

      if (!ok) {
        return res.render("login", {
          error: "비밀번호가 틀렸습니다."
        });
      }

      req.session.admin = true;
      req.session.adminId = adminUser.id;
      req.session.adminUsername = adminUser.username;

      res.redirect("/");
    } catch (err) {
      console.error("로그인 오류:", err);
      res.status(500).send("로그인 중 오류가 발생했습니다.");
    }
  });

  app.post("/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect("/");
    });
  });

  app.post("/logout-beacon", (req, res) => {
    req.session.destroy(() => {
      res.status(204).end();
    });
  });

  app.post("/delete/:id", requireAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM posts WHERE id = $1", [req.params.id]);
      res.redirect("/");
    } catch (err) {
      console.error("삭제 오류:", err);
      res.status(500).send("삭제 중 오류가 발생했습니다.");
    }
  });

  app.post("/comment/:postId", requireAdmin, async (req, res) => {
    try {
      const { content } = req.body;

      if (!content || !String(content).trim()) {
        return res.redirect(`/post/${req.params.postId}`);
      }

      await pool.query(
        `INSERT INTO comments (post_id, content, author_name, parent_id)
         VALUES ($1, $2, '관리자', NULL)`,
        [req.params.postId, String(content).trim()]
      );

      res.redirect(`/post/${req.params.postId}`);
    } catch (err) {
      console.error("댓글 작성 오류:", err);
      res.status(500).send("댓글 작성 중 오류가 발생했습니다.");
    }
  });

  app.post("/reply/:postId/:commentId", requireAdmin, async (req, res) => {
    try {
      const { content } = req.body;

      if (!content || !String(content).trim()) {
        return res.redirect(`/post/${req.params.postId}`);
      }

      await pool.query(
        `INSERT INTO comments (post_id, content, author_name, parent_id)
         VALUES ($1, $2, '관리자', $3)`,
        [req.params.postId, String(content).trim(), req.params.commentId]
      );

      res.redirect(`/post/${req.params.postId}`);
    } catch (err) {
      console.error("답글 작성 오류:", err);
      res.status(500).send("답글 작성 중 오류가 발생했습니다.");
    }
  });

  app.get("/change-password", requireAdmin, (req, res) => {
    res.render("change-password", {
      error: null,
      success: null
    });
  });

  app.post("/change-password", requireAdmin, async (req, res) => {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.render("change-password", {
          error: "모든 값을 입력해주세요.",
          success: null
        });
      }

      if (newPassword.length < 4) {
        return res.render("change-password", {
          error: "새 비밀번호는 4자 이상이어야 합니다.",
          success: null
        });
      }

      if (newPassword !== confirmPassword) {
        return res.render("change-password", {
          error: "새 비밀번호와 확인 비밀번호가 일치하지 않습니다.",
          success: null
        });
      }

      const result = await pool.query(
        "SELECT * FROM admins WHERE id = $1",
        [req.session.adminId]
      );

      if (result.rows.length === 0) {
        return res.status(404).send("관리자 계정을 찾을 수 없습니다.");
      }

      const adminUser = result.rows[0];
      const currentOk = await bcrypt.compare(
        currentPassword,
        adminUser.password_hash
      );

      if (!currentOk) {
        return res.render("change-password", {
          error: "현재 비밀번호가 일치하지 않습니다.",
          success: null
        });
      }

      const newHash = await bcrypt.hash(newPassword, 10);

      await pool.query(
        "UPDATE admins SET password_hash = $1 WHERE id = $2",
        [newHash, req.session.adminId]
      );

      return res.render("change-password", {
        error: null,
        success: "비밀번호가 즉시 변경되었습니다."
      });
    } catch (err) {
      console.error("비밀번호 변경 오류:", err);
      res.status(500).send("비밀번호 변경 중 오류가 발생했습니다.");
    }
  });

  app.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("헬스체크 오류:", err);
      res.status(500).json({ ok: false });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to bootstrap app:", err);
  process.exit(1);
});
