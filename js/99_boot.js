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
  /* v51：這一趟同時做兩件事——把後端叫醒，順便拿登入頁要用的使用者名單。
     後端睡著時第一趟要 12 秒（實測），趁使用者在打 PIN 的幾秒先暖好，
     登入就只剩正常的 2.5 秒。刻意**只打這一支**，不為了名單多一趟往返。
     不需要通行證、只回名字（不回密碼/角色/任何營運資料），失敗也不擋登入。 */
  try{ if(typeof loadLoginUsers==='function') loadLoginUsers(); }catch(e){}
})();
