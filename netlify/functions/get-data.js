const postgres = require('postgres');

// ตรวจสอบและดึงค่า Database Connection จาก Netlify Environment
const sql = postgres(process.env.NETLIFY_DB_URL);

exports.handler = async (event, context) => {
  try {
    // โค้ดสำหรับดึงรายชื่อตารางทั้งหมดในฐานข้อมูล Postgres
const data = await sql`
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public'
`;
 

    return {
      statusCode: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      },
      body: JSON.stringify({ success: true, data: data }),
    };
  } catch (error) {
    // ปริ้น Error จริงออกทาง Terminal ของ VS Code เพื่อวิเคราะห์
    console.error("❌ Database Error จากหลังบ้าน:", error.message); 
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
