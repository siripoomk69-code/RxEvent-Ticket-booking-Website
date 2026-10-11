import postgres from 'postgres';

// เชื่อมต่อฐานข้อมูลโดยดึงค่าอัตโนมัติจาก Netlify Database
const sql = postgres(process.env.NETLIFY_DB_URL);

export const handler = async (event, context) => {
  try {
    // 💡 แก้ไขคำสั่ง SQL ตรงนี้ตามชื่อตาราง (Table) ของคุณ เช่น SELECT * FROM users
    const data = await sql`SELECT NOW() as current_time`; 

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, data: data }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
