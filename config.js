/* ===========================================================
   這個檔案只放設定，上傳一次就好。
   以後更新 index.html 都不會動到這裡，設定不會再被洗掉。
   ⚠️ 請把 PASTE_ 開頭的字換成你 Firebase 專案的值。
   =========================================================== */
window.TRIP_CONFIG = {
  firebase: {
    apiKey: "AIzaSyBn31fdiicqypyJoiB_3wnfLsS6osmm4Kc",
    authDomain: "trip-850a4.firebaseapp.com",
    databaseURL: "https://trip-850a4-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "trip-850a4"
  },
  // 全團共用代號，要和資料庫裡現有的節點名稱一致，否則會讀到空的行程
  tripId: "chubu-2026-7k3p9q"
};
