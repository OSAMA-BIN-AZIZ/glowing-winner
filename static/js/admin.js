async function uploadBodyImage() {
    const input = document.getElementById('bodyImage');
    if (!input || !input.files.length) {
        alert('请先选择图片');
        return;
    }

    const formData = new FormData();
    formData.append('image', input.files[0]);

    const response = await fetch('/admin/upload-image', {
        method: 'POST',
        body: formData,
    });
    const result = await response.json();
    if (!result.ok) {
        alert(result.message || '上传失败');
        return;
    }

    const textarea = document.querySelector('textarea[name="content"]');
    textarea.value += `\n<p><img src="${result.url}" alt="image"></p>\n`;
    alert('图片已上传，已插入正文。');
}
