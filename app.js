const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const methodOverride = require("method-override");

const app = express();
const PORT = 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(methodOverride("_method"));

/*
  ------------------------------------------------------------
  기존 프로젝트의 게시글 데이터 구조를 최대한 유지한다고 가정한 예시입니다.
  이미 posts/store/db가 있으면 그 부분만 그대로 쓰고,
  아래 comments 필드만 추가해서 사용하면 됩니다.
  ------------------------------------------------------------
*/
let posts = [
  {
    id: 1,
    title: "첫 번째 글",
    content: "게시글 내용입니다.",
    author: "관리자",
    createdAt: new Date(),
    comments: []
  }
];

/*
  ------------------------------------------------------------
  관리자 판별
  ------------------------------------------------------------
  실제 프로젝트에 로그인/세션이 있으면 아래 부분만 교체하세요.

  예:
  const isAdmin = req.session?.user?.role === "admin";

  지금은 최소 동작 예시로 ?admin=1 또는 body/admin=1 이면 관리자 처리
  ------------------------------------------------------------
*/
function checkAdmin(req) {
  return req.query.admin === "1" || req.body.admin === "1";
}

function ensureCommentsField(post) {
  if (!post.comments) post.comments = [];
  post.comments.forEach((comment) => {
    if (!comment.replies) comment.replies = [];
  });
}

function findPostById(id) {
  return posts.find((post) => String(post.id) === String(id));
}

function makeId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

/*
  ------------------------------------------------------------
  기존 목록 화면
  ------------------------------------------------------------
*/
app.get("/", (req, res) => {
  res.render("index", {
    posts
  });
});

/*
  ------------------------------------------------------------
  기존 상세보기 화면
  ------------------------------------------------------------
*/
app.get("/posts/:id", (req, res) => {
  const post = findPostById(req.params.id);

  if (!post) {
    return res.status(404).send("게시글을 찾을 수 없습니다.");
  }

  ensureCommentsField(post);

  res.render("show", {
    post,
    isAdmin: checkAdmin(req)
  });
});

/*
  ------------------------------------------------------------
  댓글 등록 - 관리자만 가능
  ------------------------------------------------------------
*/
app.post("/posts/:id/comments", (req, res) => {
  const post = findPostById(req.params.id);

  if (!post) {
    return res.status(404).send("게시글을 찾을 수 없습니다.");
  }

  if (!checkAdmin(req)) {
    return res.status(403).send("댓글 작성 권한이 없습니다.");
  }

  ensureCommentsField(post);

  const content = (req.body.content || "").trim();

  if (!content) {
    return res.redirect(`/posts/${post.id}?admin=1`);
  }

  post.comments.push({
    id: makeId(),
    author: "관리자",
    content,
    createdAt: new Date(),
    replies: []
  });

  return res.redirect(`/posts/${post.id}?admin=1`);
});

/*
  ------------------------------------------------------------
  답글 등록 - 관리자만 가능
  답글은 해당 댓글 바로 아래에 저장
  ------------------------------------------------------------
*/
app.post("/posts/:id/comments/:commentId/replies", (req, res) => {
  const post = findPostById(req.params.id);

  if (!post) {
    return res.status(404).send("게시글을 찾을 수 없습니다.");
  }

  if (!checkAdmin(req)) {
    return res.status(403).send("답글 작성 권한이 없습니다.");
  }

  ensureCommentsField(post);

  const comment = post.comments.find(
    (item) => String(item.id) === String(req.params.commentId)
  );

  if (!comment) {
    return res.status(404).send("부모 댓글을 찾을 수 없습니다.");
  }

  if (!comment.replies) comment.replies = [];

  const content = (req.body.content || "").trim();

  if (!content) {
    return res.redirect(`/posts/${post.id}?admin=1`);
  }

  comment.replies.push({
    id: makeId(),
    author: "관리자",
    content,
    createdAt: new Date()
  });

  return res.redirect(`/posts/${post.id}?admin=1`);
});

/*
  ------------------------------------------------------------
  예시 게시글 추가 라우트
  기존 관리자 UI가 이미 있으면 그걸 그대로 사용하세요.
  아래는 샘플용입니다.
  ------------------------------------------------------------
*/
app.get("/admin/new", (req, res) => {
  res.send(`
    <form method="POST" action="/admin/posts">
      <input type="hidden" name="admin" value="1" />
      <input name="title" placeholder="제목" />
      <br />
      <textarea name="content" placeholder="내용"></textarea>
      <br />
      <button type="submit">등록</button>
    </form>
  `);
});

app.post("/admin/posts", (req, res) => {
  if (!checkAdmin(req)) {
    return res.status(403).send("관리자만 작성 가능합니다.");
  }

  const title = (req.body.title || "").trim();
  const content = (req.body.content || "").trim();

  if (!title || !content) {
    return res.send("제목과 내용을 입력하세요.");
  }

  posts.unshift({
    id: makeId(),
    title,
    content,
    author: "관리자",
    createdAt: new Date(),
    comments: []
  });

  res.redirect("/?admin=1");
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
