const postEditor = createEditor('#postEditor', '#postToolbar');
const noticeEditor = createEditor('#noticeEditor', '#noticeToolbar');

const postForm = document.getElementById('postForm');
const noticeForm = document.getElementById('noticeForm');
const postList = document.getElementById('postList');
const noticeSection = document.getElementById('noticeSection');
const adminStatus = document.getElementById('adminStatus');
const openLoginBtn = document.getElementById('openLoginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginModal = document.getElementById('loginModal');
const closeLoginBtn = document.getElementById('closeLoginBtn');
const loginForm = document.getElementById('loginForm');

let isAdmin = false;

boot();

async function boot() {
  bindEvents();
  await refreshSession();
  await loadPosts();
}

function bindEvents() {
  postForm.addEventListener('submit', submitPost);
  noticeForm.addEventListener('submit', submitNotice);
  openLoginBtn.addEventListener('click', () => loginModal.classList.remove('hidden'));
  closeLoginBtn.addEventListener('click', () => loginModal.classList.add('hidden'));
  logoutBtn.addEventListener('click', logoutAdmin);
  loginForm.addEventListener('submit', loginAdmin);

  window.addEventListener('beforeunload', sendLogoutBeacon);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sendLogoutBeacon();
    }
  });
}

async function refreshSession() {
  const data = await request('/api/session');
  isAdmin = !!data.isAdmin;
  adminStatus.textContent = isAdmin ? `관리자 로그인 상태 (${data.username})` : '관리자 로그아웃 상태';
  openLoginBtn.classList.toggle('hidden', isAdmin);
  logoutBtn.classList.toggle('hidden', !isAdmin);
  noticeSection.classList.toggle('hidden', !isAdmin);
}

async function submitPost(event) {
  event.preventDefault();
  const authorName = document.getElementById('authorName').value.trim();
  const title = document.getElementById('postTitle').value.trim();
  const contentHtml = postEditor.root.innerHTML;

  await request('/api/posts', {
    method: 'POST',
    body: JSON.stringify({ authorName, title, contentHtml })
  });

  postForm.reset();
  postEditor.setContents([]);
  await loadPosts();
  alert('게시글이 등록되었습니다.');
}

async function submitNotice(event) {
  event.preventDefault();
  const title = document.getElementById('noticeTitle').value.trim();
  const contentHtml = noticeEditor.root.innerHTML;

  await request('/api/notices', {
    method: 'POST',
    body: JSON.stringify({ title, contentHtml })
  });

  noticeForm.reset();
  noticeEditor.setContents([]);
  await loadPosts();
  alert('공지글이 등록되었습니다.');
}

async function loginAdmin(event) {
  event.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  await request('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

  loginForm.reset();
  loginModal.classList.add('hidden');
  await refreshSession();
  await loadPosts();
  alert('로그인되었습니다.');
}

async function logoutAdmin() {
  await request('/api/admin/logout', { method: 'POST' });
  await refreshSession();
  await loadPosts();
}

function sendLogoutBeacon() {
  if (!isAdmin) {
    return;
  }

  const data = new Blob([JSON.stringify({ logout: true })], { type: 'application/json' });
  navigator.sendBeacon('/api/admin/logout-beacon', data);
}

async function loadPosts() {
  const data = await request('/api/posts');
  renderPosts(data.items || []);
}

function renderPosts(items) {
  postList.innerHTML = '';

  if (!items.length) {
    postList.innerHTML = '<div class="empty">아직 등록된 글이 없습니다.</div>';
    return;
  }

  for (const item of items) {
    postList.appendChild(renderPostCard(item, false));
  }
}

function renderPostCard(item, isReply) {
  const article = document.createElement('article');
  article.className = `post-item${item.notice ? ' notice' : ''}${isReply ? ' reply' : ''}`;

  const badges = [];
  if (item.notice) badges.push('<span class="badge notice">공지</span>');
  if (isReply) badges.push('<span class="badge reply">답글</span>');
  if (!item.notice && !isReply && item.displayNumber) badges.push(`<span class="badge">번호 ${item.displayNumber}</span>`);

  article.innerHTML = `
    <div class="post-header">
      <div>
        <div class="badges">${badges.join('')}</div>
        <h3 class="post-title">${escapeHtml(item.notice ? `<공지> ${item.title}` : item.title)}</h3>
        <div class="meta">작성자: ${escapeHtml(item.authorName)} · 작성일: ${formatDate(item.createdAt)}</div>
      </div>
      ${isAdmin ? `
        <div class="inline-actions">
          ${!isReply ? '<button type="button" class="secondary-btn reply-toggle-btn">답글</button>' : ''}
          <button type="button" class="danger-btn delete-btn">삭제</button>
        </div>
      ` : ''}
    </div>
    <div class="post-content">${item.contentHtml}</div>
  `;

  if (isAdmin) {
    const deleteBtn = article.querySelector('.delete-btn');
    deleteBtn?.addEventListener('click', async () => {
      if (!confirm('정말 삭제하시겠습니까?')) return;
      await request(`/api/posts/${item.id}`, { method: 'DELETE' });
      await loadPosts();
    });

    if (!isReply) {
      const replyToggleBtn = article.querySelector('.reply-toggle-btn');
      const replyForm = createReplyForm(item.id);
      article.appendChild(replyForm);
      replyToggleBtn?.addEventListener('click', () => {
        replyForm.classList.toggle('hidden');
      });
    }
  }

  if (item.children?.length) {
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'children';
    for (const child of item.children) {
      childrenWrap.appendChild(renderPostCard(child, true));
    }
    article.appendChild(childrenWrap);
  }

  return article;
}

function createReplyForm(parentId) {
  const template = document.getElementById('replyFormTemplate');
  const node = template.content.firstElementChild.cloneNode(true);
  const editorEl = node.querySelector('.reply-editor');
  const toolbarEl = node.querySelector('.reply-toolbar');
  const titleEl = node.querySelector('.reply-title');
  const cancelBtn = node.querySelector('.cancel-reply-btn');
  const editor = new Quill(editorEl, {
    theme: 'snow',
    modules: {
      toolbar: toolbarEl
    }
  });

  node.addEventListener('submit', async (event) => {
    event.preventDefault();
    await request(`/api/posts/${parentId}/replies`, {
      method: 'POST',
      body: JSON.stringify({
        title: titleEl.value.trim(),
        contentHtml: editor.root.innerHTML
      })
    });

    titleEl.value = '';
    editor.setContents([]);
    node.classList.add('hidden');
    await loadPosts();
    alert('답글이 등록되었습니다.');
  });

  cancelBtn.addEventListener('click', () => node.classList.add('hidden'));
  return node;
}

function createEditor(editorSelector, toolbarSelector) {
  return new Quill(editorSelector, {
    theme: 'snow',
    modules: {
      toolbar: toolbarSelector
    }
  });
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    credentials: 'same-origin',
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.message || '요청 처리 중 오류가 발생했습니다.');
  }
  return payload;
}

function formatDate(value) {
  return new Date(value).toLocaleString('ko-KR');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

window.addEventListener('error', (event) => {
  if (event.error?.message) {
    alert(event.error.message);
  }
});
