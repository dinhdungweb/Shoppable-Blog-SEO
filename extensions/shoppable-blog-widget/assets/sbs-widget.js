"use strict";(function(){"use strict";const y=".bp-widget",f=".bp-carousel__track",S=".bp-grid__container",_=".bp-widget__loading",b=/\[\[SBS_PRODUCTS(?::(carousel|grid))?\]\]/g;function g(){T(),C()}function T(){const e=document.querySelector(".bp-app-embed-config");if(!e)return;const t=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(r){if(!r.nodeValue||!r.nodeValue.includes("[[SBS_PRODUCTS"))return NodeFilter.FILTER_REJECT;const n=r.parentElement;return!n||n.closest("script, style, textarea, template, .bp-widget")?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}}),a=[];for(;t.nextNode();)a.push(t.currentNode);a.forEach((r,n)=>{const o=r.nodeValue||"";let c=0,s;const i=document.createDocumentFragment();for(b.lastIndex=0;(s=b.exec(o))!==null;)i.append(document.createTextNode(o.slice(c,s.index))),i.append(w(e,s[1]||e.dataset.defaultStyle||"carousel",n)),c=s.index+s[0].length;i.append(document.createTextNode(o.slice(c))),r.parentNode&&r.parentNode.replaceChild(i,r)})}function w(e,t,a){const r=document.createElement("div"),n=t==="grid"?"grid":"carousel";r.className=n==="grid"?"bp-widget bp-grid":"bp-widget bp-carousel",r.dataset.articleId=e.dataset.articleId||"",r.dataset.shop=e.dataset.shop||"",r.dataset.appUrl=e.dataset.appUrl||"/apps/shoppable-blog-seo",r.dataset.style=n,r.id=`bp-marker-widget-${Date.now()}-${a}`;const o=e.dataset.heading||"Shop Products from This Article",c=n==="grid"?`
          <div class="bp-widget__header">
            <h3 class="bp-widget__title">${d(o)}</h3>
          </div>
          <div class="bp-grid__container">
            ${E()}
          </div>
        `:`
          <div class="bp-widget__header">
            <h3 class="bp-widget__title">${d(o)}</h3>
          </div>
          <div class="bp-carousel__wrapper">
            <button class="bp-carousel__nav bp-carousel__prev" aria-label="Previous">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="bp-carousel__track">
              ${E()}
            </div>
            <button class="bp-carousel__nav bp-carousel__next" aria-label="Next">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="bp-carousel__dots"></div>
        `;return r.innerHTML=c,r}function C(){const e=document.querySelectorAll(y);if("IntersectionObserver"in window){const t=new IntersectionObserver(a=>{a.forEach(r=>{r.isIntersecting&&(m(r.target),t.unobserve(r.target))})},{rootMargin:"200px"});e.forEach(a=>t.observe(a));return}e.forEach(m)}async function m(e){if(e.dataset.loaded==="true")return;e.dataset.loaded="true";const t=e.dataset.articleId,a=e.dataset.shop,r=e.dataset.appUrl||"/apps/shoppable-blog-seo",n=e.dataset.style||"carousel";if(!t){console.warn("[SBS Widget] Missing article ID"),h(e,"Shoppable Blog marker only works on blog article pages.");return}if(!a){console.warn("[SBS Widget] Missing shop domain"),h(e,"Shoppable Blog marker is missing the shop domain.");return}try{const o=await fetch(x(r,t,a));if(!o.ok)throw new Error(`HTTP ${o.status}`);if(!(o.headers.get("content-type")||"").includes("application/json"))throw new Error("App proxy returned a non-JSON response");const s=await o.json();if(!s.products||s.products.length===0){A(e);return}I(e,s.products,s.config||{},n),k(e,n),u(r,a,t,"all","impression")}catch(o){console.error("[SBS Widget] Failed to load products",o),h(e,"Unable to load products. Check that the app proxy is active.")}}function I(e,t,a,r){const n=e.querySelector(f)||e.querySelector(S);n&&(n.innerHTML="",r==="grid"&&n.setAttribute("data-columns",e.dataset.columns||"3"),t.forEach(o=>{n.appendChild(L(e,o,a))}))}function L(e,t,a){const r=document.createElement("div");r.className="bp-product-card",r.setAttribute("role","article"),r.setAttribute("aria-label",t.productTitle||"Product");const n=`/products/${t.productHandle}`;let o="";t.productImage&&(o+=`
        <div class="bp-product-card__image-wrapper">
          <img
            class="bp-product-card__image"
            src="${d(t.productImage)}"
            alt="${d(t.productTitle)}"
            loading="lazy"
            width="300"
            height="300"
          />
        </div>
      `),o+='<div class="bp-product-card__body">',o+=`
      <h4 class="bp-product-card__title">
        <a href="${n}" data-product-id="${d(t.productId)}">${d(t.productTitle)}</a>
      </h4>
    `,a.showPrice!==!1&&(o+=`<p class="bp-product-card__price">${M(t.productPrice||"0")}</p>`),a.showAddToCart!==!1&&(o+=`
        <button
          class="bp-product-card__cta"
          data-product-id="${d(t.productId)}"
          data-product-handle="${d(t.productHandle)}"
          aria-label="Add ${d(t.productTitle)} to cart"
        >
          Add to Cart
        </button>
      `),o+="</div>",r.innerHTML=o,r.addEventListener("click",s=>{s.target.closest(".bp-product-card__cta")||u(e.dataset.appUrl,e.dataset.shop,e.dataset.articleId,t.productId,"click")});const c=r.querySelector(".bp-product-card__cta");return c&&c.addEventListener("click",async s=>{s.preventDefault(),s.stopPropagation(),await $(c,t,e)}),r}function k(e,t){if(t!=="carousel")return;const a=e.querySelector(f),r=e.querySelector(".bp-carousel__prev"),n=e.querySelector(".bp-carousel__next"),o=e.querySelector(".bp-carousel__dots");if(!a)return;const c=a.querySelectorAll(".bp-product-card");if(c.length===0)return;const s=()=>c[0].offsetWidth+16;if(r&&r.addEventListener("click",()=>a.scrollBy({left:-s(),behavior:"smooth"})),n&&n.addEventListener("click",()=>a.scrollBy({left:s(),behavior:"smooth"})),!o||c.length<=1)return;const i=Math.floor(a.offsetWidth/s())||1,P=Math.ceil(c.length/i);o.innerHTML="";for(let l=0;l<P;l++){const p=document.createElement("button");p.className=`bp-carousel__dot${l===0?" bp-carousel__dot--active":""}`,p.setAttribute("aria-label",`Page ${l+1}`),p.addEventListener("click",()=>{a.scrollTo({left:l*i*s(),behavior:"smooth"})}),o.appendChild(p)}a.addEventListener("scroll",()=>{const l=Math.round(a.scrollLeft/(i*s()));o.querySelectorAll(".bp-carousel__dot").forEach((p,U)=>{p.classList.toggle("bp-carousel__dot--active",U===l)})})}async function $(e,t,a){const r=e.textContent;e.disabled=!0,e.textContent="Adding...";try{const o=await(await fetch(`/products/${t.productHandle}.js`)).json();if(!o.variants||o.variants.length===0)throw new Error("No variants available");const c=o.variants[0].id;if(!(await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:[{id:c,quantity:1}]})})).ok)throw new Error("Cart error");e.textContent="Added!",e.classList.add("bp-product-card__cta--added"),u(a.dataset.appUrl,a.dataset.shop,a.dataset.articleId,t.productId,"add_to_cart"),typeof window.refreshCart=="function"&&window.refreshCart(),document.dispatchEvent(new CustomEvent("cart:item-added",{detail:{variantId:c,quantity:1}})),setTimeout(()=>{e.textContent=r,e.classList.remove("bp-product-card__cta--added"),e.disabled=!1},2e3)}catch(n){console.error("[SBS Widget] Add to cart failed",n),e.textContent="Error - Try Again",e.disabled=!1,setTimeout(()=>{e.textContent=r},2e3)}}function u(e,t,a,r,n){try{const o=N(),c=new URLSearchParams({shop:t,articleId:a,productId:r,eventType:n,sessionId:o,referrer:document.referrer||""}),s=new Image;s.src=`${R(e)}?${c.toString()}`}catch(o){}}function x(e,t,a){const r=v(e);return`${r.startsWith("/")?`${r}/widget`:`${r}/api/widget`}?articleId=${encodeURIComponent(t)}&shop=${encodeURIComponent(a)}`}function R(e){const t=v(e);return t.startsWith("/")?`${t}/track`:`${t}/api/track`}function v(e){return(e||"/apps/shoppable-blog-seo").replace(/\/+$/,"")}function N(){let e=sessionStorage.getItem("bp_sid");return e||(e=`bp_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,sessionStorage.setItem("bp_sid",e)),e}function A(e){const t=e.querySelector(_);t&&(t.innerHTML='<p class="bp-widget__empty">No products to display.</p>')}function h(e,t){const a=e.querySelector(_);a&&(a.innerHTML=`<p class="bp-widget__empty">${d(t)}</p>`)}function E(){return`
      <div class="bp-widget__loading">
        <div class="bp-widget__spinner"></div>
        <p>Loading products...</p>
      </div>
    `}function M(e){var a,r;const t=parseFloat(e||"0");return new Intl.NumberFormat(void 0,{style:"currency",currency:((r=(a=window.Shopify)==null?void 0:a.currency)==null?void 0:r.active)||"USD"}).format(t)}function d(e){const t=document.createElement("div");return t.textContent=e||"",t.innerHTML}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",g):g()})();
