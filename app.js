const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sanitizeHtml = require('sanitize-html');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const { createClient } = require('redis');
const { RedisStore } = require('connect-redis');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-now';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const TRUST_PROXY = Number(process.env.TRUST_PROXY || 1);
const POST_MAX_HTML_LENGTH = Number(process.env.POST_MAX_HTML_LENGTH || 50000);

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL 이 설정되지 않았습니다.');
}
if (!REDIS_URL) {
  throw new Error('REDIS_URL 이 설정되지 않았습니다.');
}

app.set('trust proxy', TRUST_PROXY);

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (error) => {
  console.error('Redis error:', error);
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' }
});

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/static', express.static(path.join(__dirname, 'public')));

async function bootstrap() {
  await redisClient.connect();

  app.use(
    session({
      store: new RedisStore({ client: redisClient, prefix: 'board:sess:' }),
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: NODE_ENV === 'production',
        maxAge: 1000 * 60 * 30
      }
    })
  );

  await initDb();
  registerRoutes();

  app.listen(PORT, () => {
    console.log(`Board app listening on port ${PORT}`);
  });
}

function registerRoutes() {
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      const pong = await redisClient.ping();
      res.json({ ok: true, postgres: 'ok', redis: pong, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, message: '의존 서비스 상태 확인 실패' });
    }
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.get('/api/session', (req, res) => {
    res.json({
      isAdmin: !!req.session.isAdmin,
      username: req.session.isAdmin ? ADMIN_USERNAME : null
    });
  });

  app.post('/api/admin/login', loginLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: '아이디와 비밀번호를 입력하세요.' });
      }
      if (username !== ADMIN_USERNAME) {
        return res.status(401).json({ message: '관리자 로그인에 실패했습니다.' });
      }

      const ok = ADMIN_PASSWORD_HASH && (await bcrypt.compare(password, ADMIN_PASSWORD_HASH));
      if (!ok) {
        return res.status(401).json({ message: '관리자 로그인에 실패했습니다.' });
      }

      req.session.regenerate((error) => {
        if (error) {
          console.error(error);
          return res.status(500).json({ message: '세션 생성 중 오류가 발생했습니다.' });
        }

        req.session.isAdmin = true;
        req.session.save((saveError) => {
          if (saveError) {
            console.error(saveError);
            return res.status(500).json({ message: '세션 저장 중 오류가 발생했습니다.' });
          }
          res.json({ message: '로그인되었습니다.' });
        });
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: '로그인 처리 중 오류가 발생했습니다.' });
    }
  });

  app.post('/api/admin/logout', requireAdminOptional, (req, res) => {
    destroySession(req, res, false);
  });

  app.post('/api/admin/logout-beacon', requireAdminOptional, (req, res) => {
    destroySession(req, res, true);
  });

  app.get('/api/posts', async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT id, parent_id, notice, display_number, author_name, title, content_html, created_at, updated_at
        FROM posts
        ORDER BY
          CASE WHEN notice THEN 0 ELSE 1 END ASC,
          CASE WHEN notice THEN created_at END DESC,
          CASE WHEN NOT notice AND parent_id IS NULL THEN display_number END DESC,
          CASE WHEN parent_id IS NOT NULL THEN created_at END ASC
      `);
      res.json({ items: buildTree(rows) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: '게시글을 불러오지 못했습니다.' });
    }
  });

  app.post('/api/posts', writeLimiter, async (req, res) => {
    const authorName = cleanText(req.body.authorName, 30);
    const title = cleanText(req.body.title, 120);
    const contentHtml = sanitizeContent(req.body.contentHtml || '');

    if (!authorName || !title || isMeaninglessHtml(contentHtml)) {
      return res.status(400).json({ message: '작성자, 제목, 내용을 모두 입력하세요.' });
    }

    try {
      const insertResult = await pool.query(
        `INSERT INTO posts (parent_id, notice, display_number, author_name, title, content_html)
         VALUES (NULL, FALSE, nextval('post_display_number_seq'), $1, $2, $3)
         RETURNING id, display_number`,
        [authorName, title, contentHtml]
      );
      res.json({
        message: '게시글이 등록되었습니다.',
        id: insertResult.rows[0].id,
        displayNumber: Number(insertResult.rows[0].display_number)
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: '게시글 저장 중 오류가 발생했습니다.' });
    }
  });

  app.post('/api/notices', requireAdmin, writeLimiter, async (req, res) => {
    const title = cleanText(req.body.title, 120);
    const contentHtml = sanitizeContent(req.body.contentHtml || '');
    if (!title || isMeaninglessHtml(contentHtml)) {
      return res.status(400).json({ message: '공지 제목과 내용을 입력하세요.' });
    }

    try {
      const result = await pool.query(
        `INSERT INTO posts (parent_id, notice, display_number, author_name, title, content_html)
         VALUES (NULL, TRUE, NULL, '관리자', $1, $2)
         RETURNING id`,
        [title, contentHtml]
      );
      res.json({ message: '공지글이 등록되었습니다.', id: result.rows[0].id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: '공지 저장 중 오류가 발생했습니다.' });
    }
  });

  app.post('/api/posts/:id/replies', requireAdmin, writeLimiter, async (req, res) => {
    const parentId = Number(req.params.id);
    const title = cleanText(req.body.title, 120) || '관리자 답글';
    const contentHtml = sanitizeContent(req.body.contentHtml || '');
    if (!parentId || isMeaninglessHtml(contentHtml)) {
      return res.status(400).json({ message: '답글 내용을 입력하세요.' });
    }

    try {
      const parentResult = await pool.query('SELECT id, parent_id FROM posts WHERE id = $1', [parentId]);
      const parent = parentResult.rows[0];
      if (!parent) {
        return res.status(404).json({ message: '부모글을 찾을 수 없습니다.' });
      }
      if (parent.parent_id) {
        return res.status(400).json({ message: '답글에는 다시 답글을 달 수 없습니다.' });
      }

      const result = await pool.query(
        `INSERT INTO posts (parent_id, notice, display_number, author_name, title, content_html)
         VALUES ($1, FALSE, NULL, '관리자', $2, $3)
         RETURNING id`,
        [parentId, title, contentHtml]
      );
      res.json({ message: '답글이 등록되었습니다.', id: result.rows[0].id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: '답글 저장 중 오류가 발생했습니다.' });
    }
  });

  app.delete('/api/posts/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: '잘못된 게시글 번호입니다.' });
    }

    try {
      const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
      }
      res.json({ message: '게시글이 삭제되었습니다.' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: '삭제 중 오류가 발생했습니다.' });
    }
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  });
}

async function initDb() {
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS post_display_number_seq START WITH 1 INCREMENT BY 1;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id BIGSERIAL PRIMARY KEY,
      parent_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
      notice BOOLEAN NOT NULL DEFAULT FALSE,
      display_number INTEGER,
      author_name VARCHAR(30) NOT NULL,
      title VARCHAR(120) NOT NULL,
      content_html TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_posts_root_order
    ON posts (notice, display_number DESC, created_at DESC)
    WHERE parent_id IS NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_posts_parent_created
    ON posts (parent_id, created_at ASC)
    WHERE parent_id IS NOT NULL;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'posts_set_updated_at'
      ) THEN
        CREATE TRIGGER posts_set_updated_at
        BEFORE UPDATE ON posts
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
      END IF;
    END $$;
  `);
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(403).json({ message: '관리자 권한이 필요합니다.' });
  }
  next();
}

function requireAdminOptional(_req, _res, next) {
  next();
}

function destroySession(req, res, isBeacon) {
  if (!req.session) {
    return isBeacon ? res.status(204).end() : res.json({ message: '로그아웃되었습니다.' });
  }

  req.session.destroy((error) => {
    if (error) {
      console.error(error);
      return isBeacon
        ? res.status(500).end()
        : res.status(500).json({ message: '로그아웃 처리 중 오류가 발생했습니다.' });
    }

    res.clearCookie('connect.sid');
    return isBeacon ? res.status(204).end() : res.json({ message: '로그아웃되었습니다.' });
  });
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function sanitizeContent(value) {
  const limited = String(value || '').slice(0, POST_MAX_HTML_LENGTH);
  return sanitizeHtml(limited, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'div',
      'blockquote', 'code', 'pre', 'ul', 'ol', 'li', 'a',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      span: ['style'],
      div: ['style'],
      p: ['style'],
      h1: ['style'],
      h2: ['style'],
      h3: ['style'],
      h4: ['style'],
      h5: ['style'],
      h6: ['style']
    },
    allowedStyles: {
      '*': {
        color: [/^.*$/],
        'background-color': [/^.*$/],
        'font-size': [/^.*$/],
        'font-family': [/^.*$/],
        'text-align': [/^.*$/]
      }
    },
    allowedSchemes: ['http', 'https', 'mailto']
  });
}

function isMeaninglessHtml(html) {
  const textOnly = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, '');
  return !textOnly;
}

function buildTree(rows) {
  const map = new Map();
  const roots = [];

  for (const row of rows) {
    const item = {
      id: Number(row.id),
      parentId: row.parent_id ? Number(row.parent_id) : null,
      notice: row.notice,
      displayNumber: row.display_number,
      authorName: row.author_name,
      title: row.title,
      contentHtml: row.content_html,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      children: []
    };
    map.set(item.id, item);
  }

  for (const item of map.values()) {
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId).children.push(item);
    } else {
      roots.push(item);
    }
  }

  for (const item of map.values()) {
    item.children.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  roots.sort((a, b) => {
    if (a.notice !== b.notice) {
      return a.notice ? -1 : 1;
    }
    if (a.notice && b.notice) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }
    return Number(b.displayNumber || 0) - Number(a.displayNumber || 0);
  });

  return roots;
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap app:', error);
  process.exit(1);
});

