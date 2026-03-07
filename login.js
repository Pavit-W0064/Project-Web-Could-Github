const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require("./db");
const app = express();

// โหลด .env (ให้ใช้ได้ทั้ง localhost และ EC2)
require('dotenv').config({ path: path.join(__dirname, '.env') });

app.use(express.json());

// CORS: จำเป็นถ้าเอา Frontend ไปไว้คนละโดเมน (เช่น Amplify) แล้วเรียก API ที่ EC2
// - ถ้าไม่ใส่ CORS_ORIGINS จะ allow ทุก origin (สะดวกตอน dev)
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // Postman/curl
    if (corsOrigins.length === 0) return cb(null, true);
    return corsOrigins.includes(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.static(path.join(__dirname)));


// ==========================================
// 1. ADMIN LOGIN (เชื่อม MySQL)
// ==========================================
app.post('/checkLoginAdminData', (req, res) => {
    const { adminEmail, adminPassword } = req.body;
    console.log('[DEBUG] Admin login attempt:', { adminEmail });

    const sql = `
        SELECT * FROM queue_admin
        WHERE email = ? AND password = ?
    `;

    db.query(sql, [adminEmail, adminPassword], (err, result) => {
        if (err) return res.json({ checkAdmin: false });

        if (result.length > 0) {
            res.json({
                checkAdmin: true,
                page: "/dashboard.html"
            });
        } else {
            res.json({
                checkAdmin: false,
                title: "Login failed",
                text: "Email or password incorrect",
                icon: "error"
            });
        }
    });
});

// ==========================================
// ADMIN: GET ADMINS
// ==========================================
app.get('/api/getAdmins', (req, res) => {

    const sql = "SELECT * FROM queue_admin";

    db.query(sql, (err, result) => {
        if (err) {
            console.error(err);
            return res.json({ success: false });
        }

        res.json({
            success: true,
            admins: result
        });
    });
});

// ==========================================
// ADMIN: ADD ADMIN
// ==========================================
app.post('/api/addAdmin', (req, res) => {

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.json({ success: false, message: "ข้อมูลไม่ครบ" });
    }

    const checkSql = "SELECT * FROM queue_admin WHERE email = ?";

    db.query(checkSql, [email], (err, result) => {
        if (err) return res.json({ success: false });

        if (result.length > 0) {
            return res.json({
                success: false,
                message: "Email นี้ถูกใช้แล้ว"
            });
        }

        const insertSql = `
            INSERT INTO queue_admin (username, email, password)
            VALUES (?, ?, ?)
        `;

        db.query(insertSql, [username, email, password], (err2) => {
            if (err2) {
                console.error(err2);
                return res.json({ success: false });
            }

            res.json({ success: true });
        });
    });
});


// ==========================================
// ADMIN: DELETE ADMIN
// ==========================================
app.delete('/api/deleteAdmin/:id', (req, res) => {

    const id = req.params.id;

    const sql = "DELETE FROM queue_admin WHERE id = ?";

    db.query(sql, [id], (err) => {
        if (err) {
            console.error(err);
            return res.json({ success: false });
        }

        res.json({ success: true });
    });
});


// ==========================================
// ADMIN: UPDATE ADMIN
// ==========================================
app.put('/api/updateAdmin/:id', (req, res) => {

    const id = req.params.id;
    const { username, email, password } = req.body;

    const sql = `
        UPDATE queue_admin
        SET username = ?, email = ?, password = ?
        WHERE id = ?
    `;

    db.query(sql, [username, email, password, id], (err) => {
        if (err) {
            console.error(err);
            return res.json({ success: false });
        }

        res.json({ success: true });
    });
});

// ==========================================
// 2. BOOK ROOM
// ==========================================
app.post('/api/book-room', (req, res) => {
    const { name, student_id, room, date, timeSlot } = req.body;
    console.log('[DEBUG] Book-room payload:', { name, student_id, room, date, timeSlot });

    if (!name || !student_id || !room || !date || !timeSlot) {
        return res.json({ success: false, message: "ข้อมูลไม่ครบ" });
    }

    const checkSql = `
        SELECT * FROM queue_contact
        WHERE subject = ? AND date = ? AND message = ?
    `;

    db.query(checkSql, [room, date, timeSlot], (err, result) => {
        if (err) {
            console.error('[ERROR] book-room checkSql failed:', err);
            return res.json({ success: false });
        }

        if (result.length > 0) {
            return res.json({
                success: false,
                message: "ห้องถูกจองแล้ว"
            });
        }

            // we don't have a `status` column in the original table scheme,
        // so only insert the fields that actually exist.  the front‑end will
        // assume "จองแล้ว" when `status` is missing.
        const insertSql = `
            INSERT INTO queue_contact
            (username, email, subject, message, date)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(insertSql, [name, student_id, room, timeSlot, date], (err2) => {
            if (err2) {
                console.error('[ERROR] book-room insert failed:', err2);
                return res.json({ success: false, message: "บันทึกไม่ได้"  });
            }

            res.json({ 
                success: true,
                booking: { name, student_id, room, date, timeSlot }
            });
        });
    });
});


// ==========================================
// GET BOOKINGS
// ==========================================
app.get('/api/getBookings', (req, res) => {
    // select all bookings; client treats missing `status` as 'จองแล้ว'
    const sql = "SELECT * FROM queue_contact ORDER BY date ASC";

    db.query(sql, (err, result) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, bookings: result });
    });
});


// ==========================================
// CANCEL BOOKING
// ==========================================
app.post('/api/cancel-booking', (req, res) => {
    const { bookingId, student_id } = req.body;

    if (!bookingId) {
        return res.json({ success: false, message: "ไม่พบรหัสคิว" });
    }

    // ถ้าเป็น admin (ไม่มี student_id) → ลบได้เลย
    if (!student_id) {
        const sql = "DELETE FROM queue_contact WHERE id = ?";
        db.query(sql, [bookingId], (err) => {
            if (err) {
                console.error(err);
                return res.json({ success: false });
            }
            return res.json({ success: true });
        });
        return;
    }

    // ถ้าเป็น student → ต้องตรวจสอบสิทธิ์ก่อน
    const checkSql = "SELECT * FROM queue_contact WHERE id = ? AND email = ?";
    db.query(checkSql, [bookingId, student_id], (err, result) => {

        if (err) return res.json({ success: false });

        if (result.length === 0) {
            return res.json({ success: false, message: "คุณไม่มีสิทธิ์ลบ" });
        }

        const sql = "DELETE FROM queue_contact WHERE id = ?";
        db.query(sql, [bookingId], (err2) => {
            if (err2) return res.json({ success: false });
            res.json({ success: true });
        });
    });
});


// ==========================================
// ADMIN: GET STUDENTS
// ==========================================
app.get('/api/getUsers', (req, res) => {
    const sql = "SELECT * FROM queue_students";

    db.query(sql, (err, result) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, users: result });
    });
});


// ==========================================
// 3. DASHBOARD SUMMARY
// ==========================================
app.get('/api/dashboard', (req, res) => {

    const sqlBookings = "SELECT COUNT(*) AS total FROM queue_contact";
    const sqlStudents = "SELECT COUNT(*) AS total FROM queue_students";

    db.query(sqlBookings, (err, bResult) => {
        if (err) return res.json({ success: false });

        db.query(sqlStudents, (err2, sResult) => {
            if (err2) return res.json({ success: false });

            res.json({
                countBookings: bResult[0].total,
                countStudents: sResult[0].total,
                countAdmin: 1
            });
        });
    });
});


// ==========================================
// 4. REGISTER STUDENT
// ==========================================
app.post('/api/register', (req, res) => {
    const { student_id, name, password } = req.body;
    console.log('[DEBUG] Register attempt:', { student_id, name });

    if (!student_id || !name || !password) {
        return res.json({
            success: false,
            message: "กรอกข้อมูลให้ครบ"
        });
    }

    // เช็คว่ามี studentId นี้ในระบบแล้วไหม
    const checkSql = `
        SELECT * FROM queue_students
        WHERE student_id = ?
    `;

    db.query(checkSql, [student_id], (err, result) => {
        if (err) {
            console.error('[ERROR] register checkSql failed:', err);
            return res.json({ success: false });
        }

        if (result.length > 0) {
            return res.json({
                success: false,
                message: "รหัสนักศึกษานี้ถูกใช้แล้ว"
            });
        }

        // ถ้ายังไม่มี → สมัครได้
        const insertSql = `
            INSERT INTO queue_students (student_id, username, password)
            VALUES (?, ?, ?)
        `;

        db.query(insertSql, [student_id, name, password], (err2) => {
            if (err2) {
                console.error('[ERROR] register insert failed:', err2);
                return res.json({ success: false });
            }

            res.json({
                success: true,
                message: "สมัครสำเร็จ"
            });
        });
    });
});



// ==========================================
// STUDENT LOGIN
// ==========================================
app.post('/api/login', (req, res) => {
    const { student_id, password } = req.body;
    console.log('[DEBUG] Login attempt:', { student_id });

    if (!student_id || !password) {
        return res.json({ success: false, message: "กรอกข้อมูลไม่ครบ" });
    }

    const sql = `
        SELECT * FROM queue_students
        WHERE student_id = ? AND password = ?
    `;

    db.query(sql, [student_id, password], (err, result) => {
        if (err) {
            console.error('[ERROR] login query failed:', err);
            return res.json({ success: false });
        }

        if (result.length > 0) {
            res.json({
                success: true,
                user: {
                    student_id: result[0].student_id,
                    name: result[0].username
                }
            });
        } else {
            res.json({
                success: false,
                message: "รหัสหรือรหัสผ่านผิด"
            });
        }
    });
});


// ==========================================
// DASHBOARD CHART DATA
// ==========================================
app.get('/api/dashboard-chart', (req, res) => {

    const sql = `
        SELECT subject AS room, date, message AS timeSlot
        FROM queue_contact
    `;

    db.query(sql, (err, result) => {
        if (err) return res.json({ success: false });

        const bookingByDate = {};
        const bookingByRoom = {};
        const bookingByTime = {};

        result.forEach(b => {
            bookingByDate[b.date] = (bookingByDate[b.date] || 0) + 1;
            bookingByRoom[b.room] = (bookingByRoom[b.room] || 0) + 1;
            bookingByTime[b.timeSlot] = (bookingByTime[b.timeSlot] || 0) + 1;
        });

        res.json({
            byDate: bookingByDate,
            byRoom: bookingByRoom,
            byTime: bookingByTime
        });
    });
});


// ==========================================
// START SERVER
// ==========================================
// Cancel bookings that are in the past. For bookings before today we cancel
// immediately; for bookings on today we compare the booking end time to now.
function cleanupExpiredBookings() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

    const sql = "SELECT id, date, message, status FROM queue_contact WHERE status IS NULL OR status = 'จองแล้ว'";
    db.query(sql, (err, rows) => {
        if (err) {
            console.error('[ERROR] cleanup query failed:', err);
            return;
        }

        const toCancel = [];

        rows.forEach(r => {
            const bookingDate = r.date; // expected YYYY-MM-DD
            if (!bookingDate) return;

            if (bookingDate < todayStr) {
                toCancel.push(r.id);
                return;
            }

            if (bookingDate === todayStr) {
                // parse end time from message (timeSlot) like "09:00 - 11:00"
                const msg = (r.message || '').toString();
                const parts = msg.split('-');
                if (parts.length >= 2) {
                    const endStr = parts[1].trim().split(' ')[0]; // "11:00"
                    const endIso = `${bookingDate}T${endStr}:00`;
                    const endDate = new Date(endIso);
                    if (!isNaN(endDate.getTime()) && endDate <= now) {
                        toCancel.push(r.id);
                    }
                }
            }
        });

        if (toCancel.length === 0) return;

        const placeholders = toCancel.map(() => '?').join(',');
        // If CLEANUP_DELETE is set (1 or 'true'), delete expired rows instead
        const shouldDelete = (process.env.CLEANUP_DELETE === '1' || String(process.env.CLEANUP_DELETE).toLowerCase() === 'true');

        if (shouldDelete) {
            const deleteSql = `DELETE FROM queue_contact WHERE id IN (${placeholders})`;
            db.query(deleteSql, toCancel, (uErr, uRes) => {
                if (uErr) {
                    console.error('[ERROR] cleanup delete failed:', uErr);
                    return;
                }
                console.log(`[CLEANUP] Deleted ${toCancel.length} expired booking(s)`);
            });
        } else {
            const updateSql = `UPDATE queue_contact SET status = 'ยกเลิกโดยระบบ' WHERE id IN (${placeholders})`;
            db.query(updateSql, toCancel, (uErr, uRes) => {
                if (uErr) {
                    console.error('[ERROR] cleanup update failed:', uErr);
                    return;
                }
                console.log(`[CLEANUP] Marked ${toCancel.length} booking(s) as ยกเลิกโดยระบบ`);
            });
        }
    });
}

// Run cleanup once at startup
cleanupExpiredBookings();

// Schedule cleanup interval (default 1 hour). For quick testing override
// with env CLEANUP_INTERVAL_MS.
const CLEANUP_INTERVAL_MS = process.env.CLEANUP_INTERVAL_MS ? parseInt(process.env.CLEANUP_INTERVAL_MS, 10) : 3600000;
setInterval(cleanupExpiredBookings, CLEANUP_INTERVAL_MS);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

