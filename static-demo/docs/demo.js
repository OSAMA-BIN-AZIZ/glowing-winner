const posts = [
  { title: '个人品牌网站设计思路', desc: '从定位到文案结构，快速搭建信任。' },
  { title: '轻量内容系统的优势', desc: '低成本维护，适合长期运营。' },
  { title: 'SEO 基础实践清单', desc: '标题、描述、slug 三件套。' },
];
const list = document.getElementById('list');
posts.forEach(p => {
  const item = document.createElement('article');
  item.className = 'card';
  item.innerHTML = `<h3>${p.title}</h3><p>${p.desc}</p><a class="btn" href="./post.html">查看详情</a>`;
  list.appendChild(item);
});
