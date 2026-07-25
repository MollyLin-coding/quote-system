/* ---- 啟動：檢查 session token ---- */
(function initAuth(){
  const saved=sessionStorage.getItem('quote_token');
  if(saved){ AUTH_TOKEN=saved; hideLogin(); initV2(); }
  else { showLogin(); }
})();

