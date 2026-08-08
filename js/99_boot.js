/* ---- 啟動：檢查通行證 ---- */
(function initAuth(){
  // sessionStorage 優先（這個分頁本來就登入著）；沒有就看「在這台裝置記住我」
  const sRole = (function(){ try{ return sessionStorage.getItem('quote_role'); }catch(e){ return null; } })();
  const saved = sessionStorage.getItem('quote_token') || (typeof rememberRead==='function' ? rememberRead() : null);
  if(saved){
    AUTH_TOKEN = saved;
    try{ sessionStorage.setItem('quote_token', saved); }catch(e){}
    // 這個分頁本來就登入著 → 角色從 sessionStorage 還原（rememberRead 那條路已經在裡面 setUser 過了）
    if(sRole && typeof setUser==='function'){
      try{ setUser(sRole, sessionStorage.getItem('quote_name')||''); }catch(e){}
    }
    hideLogin();
    initV2();
    return;
  }
  showLogin();
  // 先把後端叫醒：它睡著時第一趟要 12 秒（實測），
  // 趁使用者在打 PIN 的那幾秒先暖好，登入就只剩正常的 2.5 秒。
  // 這支不需要通行證、也不會動到任何資料，失敗就算了。
  try{ apiCall({ action:'verifyHeaders' }).catch(()=>{}); }catch(e){}
})();
