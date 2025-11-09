# Server Status Check

## ✅ Servers Running:

1. **Yjs WebSocket Server**: Running on `ws://localhost:1234`
   - Enhanced logging enabled
   - Tracking connections and room names
   
## 🔍 How to Test Collaboration:

### Prerequisites:
Make sure you have **3 terminal windows** running:

```bash
# Terminal 1 - Backend API
cd c:/Users/Meraj/Desktop/PROJECTS/vector/server
npm run dev

# Terminal 2 - Yjs WebSocket Server (ALREADY RUNNING)
cd c:/Users/Meraj/Desktop/PROJECTS/vector/server
npm run dev:yjs

# Terminal 3 - Frontend React App
cd c:/Users/Meraj/Desktop/PROJECTS/vector/client
npm start
```

---

## 🧪 Test Scenarios:

### Test 1: Same Browser, Multiple Tabs
1. Open Chrome browser
2. Go to `http://localhost:3000` and login
3. Create/open a file in the editor
4. **Open Chrome DevTools (F12) → Console tab**
5. Duplicate the tab (Ctrl+Shift+D) or open same file in new tab
6. **Watch Console logs for:**
   - `🔌 Yjs connection status: connected`
   - `✅ Connected to Yjs server on ws://localhost:1234`
   - `👥 Users connected: 2` (should increase)
   - Client IDs logged
7. **Type in one tab** → Should appear in other tab **WITHOUT duplication**

**Expected Behavior:**
- ✅ Changes sync instantly
- ✅ Content appears only once (no duplication)
- ✅ User count shows 2

---

### Test 2: Different Browsers
1. Open Chrome, login, open a file
2. Open Firefox, login, open **same file**
3. **Check Console in BOTH browsers**
4. **Watch for:**
   - Same room name: `file-{id}` in both
   - WebSocket connection status
   - User count should be 2
5. **Type in Chrome** → Should appear in Firefox

**Expected Behavior:**
- ✅ Both browsers connect to same room
- ✅ Changes sync between browsers
- ✅ User count matches in both browsers

---

### Test 3: Incognito Mode
1. Normal Chrome window: login, open file
2. Incognito window: login, open **same file**
3. **Check Console in both**
4. Test typing in both windows

**Expected Behavior:**
- ✅ Changes sync between normal and incognito
- ✅ Both show same user count

---

## 📊 Server Logs to Watch:

### In Terminal 2 (Yjs Server):
```
🔗 New connection to room: file-123
👥 Room "file-123" now has 1 connection(s)
📄 Created new Yjs document: file-123
🔗 New connection to room: file-123
👥 Room "file-123" now has 2 connection(s)
```

### In Browser Console:
```
🔌 Yjs connection status: connected
✅ Connected to Yjs server on ws://localhost:1234
👥 Users connected: 1
  - Client 12345: {user: {...}}
👥 Users connected: 2
  - Client 12345: {user: {...}}
  - Client 67890: {user: {...}}
```

---

## 🐛 Troubleshooting:

### Issue: Content Duplicates
- **Check:** Yjs document initialization in setupYjs
- **Solution:** Already fixed - waits for provider.on('sync') before inserting content

### Issue: Different Browsers Don't Sync
- **Check:** Room names match (should be `file-{same-id}`)
- **Check:** WebSocket connection status in both browsers
- **Check:** Network tab for WS connection errors
- **Check:** Authentication token in requests

### Issue: User Count Doesn't Match
- **Check:** Server logs for multiple rooms created
- **Check:** File IDs are the same
- **Check:** All clients connecting to ws://localhost:1234

---

## 📝 What to Report:

Please share:
1. **Room name** from console (e.g., "file-123")
2. **Connection status** messages
3. **User count** in each window/browser
4. **Any errors** in console (red text)
5. **Server logs** from Terminal 2
6. **Which test scenario** (1, 2, or 3)
7. **What happened** vs what you expected
