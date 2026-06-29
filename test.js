function slugifyKeyword(kw) {
  return kw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, '-');
}
console.log("slugify:", slugifyKeyword("phụ kiện"));
console.log("includes:", "phu-kien-nho-van-can".includes(slugifyKeyword("phụ kiện")));
