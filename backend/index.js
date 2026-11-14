const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});

app.use(cors());
app.use(express.json());

// Servir la carpeta frontend completa
app.use(express.static(path.join(__dirname, '../frontend')));

// ==========================================
// 1. ENDPOINTS DE AUTENTICACIÓN Y REGISTRO
// ==========================================

// Iniciar sesión (Validar DNI y contraseña contra la tabla usuarios)
app.post('/api/auth/login', async (req, res) => {
    const { dni, password } = req.body;
    try {
        const [rows] = await db.query(
            "SELECT * FROM usuarios WHERE dni = ? AND password = ?",
            [dni, password]
        );

        if (rows.length > 0) {
            const usuario = rows[0];
            // Devolvemos el usuario con su rol para que el frontend decida
            res.json({ success: true, usuario });
        } else {
            res.status(401).json({ success: false, mensaje: 'DNI o contraseña incorrectos' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Registrar nuevo paciente
app.post('/api/auth/registro', async (req, res) => {
    const { nombres, dni, correo, password } = req.body;

    const partes = nombres.trim().split(' ');
    const primerNombre = partes[0] || '';
    const apellidos = partes.slice(1).join(' ') || 'Sin Apellidos';

    try {
        await db.query(
            `INSERT INTO usuarios (dni, nombres, apellidos, correo, password, rol) VALUES (?, ?, ?, ?, ?, 'paciente')`,
            [dni, primerNombre, apellidos, correo, password]
        );
        res.status(201).json({ success: true, mensaje: 'Usuario registrado con éxito' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, mensaje: 'El DNI o correo ya se encuentran registrados.' });
    }
});

// ==========================================
// 2. ENDPOINTS DE HOSPITALES Y SEDES
// ==========================================
app.get('/api/establecimientos', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, nombre, ubicacion FROM establecimientos WHERE estado = 'activo'");
        const hospitales = rows.map(h => ({
            id: h.id,
            nombre: h.nombre,
            direccion: h.ubicacion,
            mapa_url: `https://maps.google.com/maps?q=${encodeURIComponent(h.nombre + ' ' + h.ubicacion)}&t=&z=15&ie=UTF8&iwloc=&output=embed`
        }));
        res.json(hospitales);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 3. ENDPOINTS DE ESPECIALIDADES (PACIENTE)
// ==========================================
app.get('/api/establecimientos/:id/especialidades', async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(`
            SELECT e.id, e.nombre, e.descripcion, e.icono 
            FROM especialidades e
            JOIN establecimiento_especialidad ee ON e.id = ee.especialidad_id
            WHERE ee.establecimiento_id = ? AND ee.estado = 'Habilitado'
        `, [id]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 4. ENDPOINTS DE ESPECIALIDADES (ADMIN)
// ==========================================
app.get('/api/admin/establecimientos/:id/especialidades', async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(`
            SELECT e.id, e.nombre, e.descripcion, e.icono, ee.estado 
            FROM especialidades e
            JOIN establecimiento_especialidad ee ON e.id = ee.especialidad_id
            WHERE ee.establecimiento_id = ?
        `, [id]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/establecimientos/:hospId/especialidades/:espId', async (req, res) => {
    const { hospId, espId } = req.params;
    const { estado } = req.body; // 'Habilitado' o 'Deshabilitado'
    try {
        await db.query(`
            UPDATE establecimiento_especialidad 
            SET estado = ? 
            WHERE establecimiento_id = ? AND especialidad_id = ?
        `, [estado, hospId, espId]);
        res.json({ mensaje: 'Estado actualizado correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ==========================================
// 5. ENDPOINTS DE GESTIÓN DE CITAS Y RESERVAS
// ==========================================

// Endpoint para obtener los médicos y horarios por hospital y especialidad (Paso 2 de reservas)
app.get('/api/establecimientos/:hospId/especialidades/:espId/medicos-horarios', async (req, res) => {
    const { hospId, espId } = req.params;
    try {
        const query = `
            SELECT h.id as horario_id, h.fecha, h.hora_inicio, h.hora_fin, h.disponible,
                   m.id as medico_id, CONCAT(m.nombres, ' ', m.apellidos) as medico_nombre,
                   e.id as especialidad_id, e.nombre as especialidad_name
            FROM horarios_medicos h
            INNER JOIN medicos m ON h.medico_id = m.id
            INNER JOIN especialidades e ON m.especialidad_id = e.id
            WHERE m.establecimiento_id = ? AND m.especialidad_id = ? AND h.estado != 'Inactivo'
        `;
        const [rows] = await db.query(query, [hospId, espId]);
        res.json(rows);
    } catch (err) {
        console.error("Error en medicos-horarios:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Registrar una nueva cita médica e inhabilitar temporalmente el horario seleccionado
app.post('/api/citas', async (req, res) => {
    const { usuario_id, horario_id, establecimiento_id, especialidad_id, medico_id } = req.body;
    try {
        // Insertar la cita cumpliendo con todas las columnas obligatorias de tu tabla
        const [result] = await db.query(
            `INSERT INTO citas (usuario_id, horario_id, establecimiento_id, especialidad_id, medico_id, estado) 
             VALUES (?, ?, ?, ?, ?, 'RESERVADA')`,
            [usuario_id, horario_id, establecimiento_id, especialidad_id, medico_id]
        );

        // Marcar el horario como NO disponible (disponible = 0) para que no vuelva a aparecer
        await db.query(
            `UPDATE horarios_medicos SET disponible = FALSE WHERE id = ?`,
            [horario_id]
        );

        const codigoAtencion = `M-${1000 + result.insertId}`;
        res.json({ success: true, codigo_atencion: codigoAtencion });
    } catch (err) {
        console.error("Error al registrar cita:", err);
        res.status(500).json({ error: err.message || 'Error al registrar la cita' });
    }
});

// ==========================================
// 6. ENDPOINTS DE GESTIÓN DE CITAS Y RESERVAS
// ==========================================

// Registrar una nueva cita médica e inhabilitar temporalmente el horario seleccionado
app.post('/api/citas', async (req, res) => {
    const { usuario_id, horario_id, establecimiento_id, especialidad_id, medico_id } = req.body;
    try {
        // Insertar la cita cumpliendo con todas las columnas obligatorias de la tabla
        const [result] = await db.query(
            `INSERT INTO citas (usuario_id, horario_id, establecimiento_id, especialidad_id, medico_id, estado) 
             VALUES (?, ?, ?, ?, ?, 'RESERVADA')`,
            [usuario_id, horario_id, establecimiento_id, especialidad_id, medico_id]
        );

        // Marcar el horario como NO disponible (disponible = 0) para que no vuelva a aparecer
        await db.query(
            `UPDATE horarios_medicos SET disponible = FALSE WHERE id = ?`,
            [horario_id]
        );

        const codigoAtencion = `M-${1000 + result.insertId}`;
        res.json({ success: true, codigo_atencion: codigoAtencion });
    } catch (err) {
        console.error("Error al registrar cita:", err);
        res.status(500).json({ error: err.message || 'Error al registrar la cita' });
    }
});

// Cancelar una cita existente y liberar el horario médico asociado para el calendario
app.put('/api/citas/:id/cancelar', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Obtener el horario_id asociado a esta cita antes de cancelarla
        const [citaRows] = await db.query(`SELECT horario_id FROM citas WHERE id = ?`, [id]);
        if (citaRows.length === 0) {
            return res.status(404).json({ error: 'Cita no encontrada' });
        }
        const horarioId = citaRows[0].horario_id;

        // 2. Actualizar el estado de la cita a 'CANCELADA'
        await db.query(`UPDATE citas SET estado = 'CANCELADA' WHERE id = ?`, [id]);

        // 3. Liberar el horario médico para que vuelva a estar disponible en el calendario
        await db.query(`UPDATE horarios_medicos SET disponible = TRUE WHERE id = ?`, [horarioId]);

        res.json({ success: true, message: 'Cita cancelada y horario liberado exitosamente.' });
    } catch (err) {
        console.error("Error al cancelar cita:", err);
        res.status(500).json({ error: 'Error al procesar la cancelación' });
    }
});


// ==========================================
// 7. ENDPOINTS DE CITAS DEL USUARIO, LISTADO DE MÉDICOS Y HORARIOS
// ==========================================

// Obtener el historial de citas activas de un paciente específico para su portal
app.get('/api/usuarios/:usuarioId/citas', async (req, res) => {
    const { usuarioId } = req.params;
    try {
        const query = `
            SELECT c.id as cita_id, c.estado, c.created_at,
                   DATE_FORMAT(h.fecha, '%Y-%m-%d') as fecha, h.hora_inicio, h.hora_fin,
                   est.nombre as establecimiento_name, est.ubicacion as establecimiento_direccion,
                   esp.nombre as especialidad_name,
                   CONCAT(m.nombres, ' ', m.apellidos) as medico_nombre
            FROM citas c
            INNER JOIN horarios_medicos h ON c.horario_id = h.id
            INNER JOIN establecimientos est ON c.establecimiento_id = est.id
            INNER JOIN especialidades esp ON c.especialidad_id = esp.id
            INNER JOIN medicos m ON h.medico_id = m.id
            WHERE c.usuario_id = ? AND c.estado != 'CANCELADA'
            ORDER BY c.id DESC
        `;
        const [rows] = await db.query(query, [usuarioId]);
        res.json(rows);
    } catch (err) {
        console.error("Error al obtener citas del usuario:", err);
        res.status(500).json({ error: err.message });
    }
});

// Listar médicos por establecimiento y especialidad (para el modal de selección de horarios)
app.get('/api/establecimientos/:hospId/especialidades/:espId/medicos-lista', async (req, res) => {
    const { hospId, espId } = req.params;
    try {
        const [rows] = await db.query(
            `SELECT id, CONCAT(nombres, ' ', apellidos) as nombre_completo 
             FROM medicos 
             WHERE establecimiento_id = ? AND especialidad_id = ?`,
            [hospId, espId]
        );
        res.json(rows);
    } catch (err) {
        console.error("Error al listar médicos:", err);
        res.status(500).json({ error: err.message });
    }
});

// Registrar un nuevo bloque horario individual asociado a un médico existente
app.post('/api/admin/horarios', async (req, res) => {
    const { medico_id, fecha, hora_inicio, hora_fin } = req.body;
    try {
        await db.query(
            `INSERT INTO horarios_medicos (medico_id, fecha, hora_inicio, hora_fin, disponible) VALUES (?, ?, ?, ?, TRUE)`,
            [medico_id, fecha, hora_inicio, hora_fin]
        );
        res.status(201).json({ success: true, mensaje: 'Horario agregado con éxito' });
    } catch (err) {
        console.error("Error al registrar horario:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// REGISTRAR NUEVO MÉDICO (ADMIN)
// ==========================================
app.post('/api/admin/medicos', async (req, res) => {
    const { nombres, apellidos, establecimiento_id, especialidad_id } = req.body;
    try {
        await db.query(
            `INSERT INTO medicos (nombres, apellidos, establecimiento_id, especialidad_id) VALUES (?, ?, ?, ?)`,
            [nombres, apellidos, establecimiento_id, especialidad_id]
        );
        res.status(201).json({ success: true, mensaje: 'Médico registrado con éxito' });
    } catch (err) {
        console.error("Error al registrar médico:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// ==========================================
// 8. ENDPOINT DE MÉTRICAS Y CIERRE DEL SERVIDOR
// ==========================================

// Endpoint para alimentar el Dashboard Administrativo con contadores en tiempo real
app.get('/api/admin/metricas', async (req, res) => {
    try {
        const [citas] = await db.query("SELECT COUNT(*) as total FROM citas WHERE estado = 'RESERVADA'"); // o 'activo' según corresponda
        const [medicos] = await db.query("SELECT COUNT(*) as total FROM medicos");
        const [pacientes] = await db.query("SELECT COUNT(*) as total FROM usuarios WHERE rol = 'paciente'");
        const [hospitales] = await db.query("SELECT COUNT(*) as total FROM establecimientos");

        res.json({
            citas_activas: citas[0].total,
            total_medicos: medicos[0].total,
            total_pacientes: pacientes[0].total,
            total_hospitales: hospitales[0].total
        });
    } catch (err) {
        console.error("Error al obtener métricas:", err);
        res.status(500).json({ error: err.message });
    }
});
// Obtener las últimas reservas registradas para el panel de administración
// Obtener únicamente las reservas activas (RESERVADA) para el panel de administración
app.get('/api/admin/citas-recientes', async (req, res) => {
    try {
        const query = `
            SELECT c.id as cita_id, u.nombres as paciente_nombre, esp.nombre as especialidad_name,
                   est.nombre as establecimiento_name, c.estado
            FROM citas c
            INNER JOIN usuarios u ON c.usuario_id = u.id
            INNER JOIN especialidades esp ON c.especialidad_id = esp.id
            INNER JOIN establecimientos est ON c.establecimiento_id = est.id
            WHERE c.estado = 'RESERVADA'
            ORDER BY c.id DESC
            LIMIT 5
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error("Error al obtener citas recientes:", err);
        res.status(500).json({ error: err.message });
    }
});

// Ruta para desactivar un horario médico mediante baja lógica (Soft Delete) protegiendo el historial del Dashboard
// Ruta para desactivar un horario médico con validación de reservas activas
app.delete('/api/horarios/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Verificamos si el horario ya está reservado por un paciente (disponible = 0 o FALSE)
        const [horarioRows] = await db.query("SELECT disponible FROM horarios_medicos WHERE id = ?", [id]);

        if (horarioRows.length > 0 && (horarioRows[0].disponible == 0 || horarioRows[0].disponible === false)) {
            return res.status(400).json({
                success: false,
                error: 'No se puede eliminar este turno porque ya cuenta con una cita reservada por un paciente.'
            });
        }

        // 2. Si está libre, procedemos con la baja lógica con total seguridad
        await db.query(
            "UPDATE horarios_medicos SET estado = 'Inactivo' WHERE id = ?",
            [id]
        );

        res.json({ success: true, message: 'Turno desactivado correctamente' });
    } catch (err) {
        console.error("Error al actualizar el estado del horario:", err);
        res.status(500).json({ success: false, error: 'Error al procesar la solicitud' });
    }
});
// ==========================================
// 9. ENDPOINT DE GESTIÓN DE HORARIOS PARA EL ADMIN
// ==========================================

// Obtener los horarios de un médico específico para mostrarlos en el modal de administración (filtrando los inactivos)
app.get('/api/medicos/:id/horarios', async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(
            "SELECT * FROM horarios_medicos WHERE medico_id = ? AND estado != 'Inactivo'",
            [id]
        );
        res.json(rows);
    } catch (err) {
        console.error("Error al obtener los horarios del médico:", err);
        res.status(500).json({ error: 'Error al cargar los horarios' });
    }
});
app.put('/api/establecimientos/:hospId/especialidades/:espId', async (req, res) => {
    const { hospId, espId } = req.params;
    const { estado } = req.body; // 'Habilitado' o 'Deshabilitado'

    try {
        // Actualización directa y libre sin bloqueos previos
        await db.query(`
            UPDATE establecimiento_especialidad 
            SET estado = ? 
            WHERE establecimiento_id = ? AND especialidad_id = ?
        `, [estado, hospId, espId]);

        res.json({ success: true, mensaje: 'Estado actualizado correctamente' });
    } catch (error) {
        console.error("Error al actualizar estado de especialidad:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Inicialización y arranque del servidor backend del sistema MINSA
app.listen(PORT, () => {
    console.log(`Backend MINSA corriendo perfectamente en http://localhost:${PORT}`);
});
// Obtener el historial de citas de un paciente por su DNI (Ideal para despliegue público sin depender de IDs numéricos locales)
app.get('/api/pacientes/:dni/citas', async (req, res) => {
    const { dni } = req.params;
    try {
        const query = `
            SELECT c.id as cita_id, c.estado, c.created_at,
                   DATE_FORMAT(h.fecha, '%Y-%m-%d') as fecha, h.hora_inicio, h.hora_fin,
                   est.nombre as establecimiento_name, est.ubicacion as establecimiento_direccion,
                   esp.nombre as especialidad_name,
                   CONCAT(m.nombres, ' ', m.apellidos) as medico_nombre
            FROM citas c
            INNER JOIN usuarios u ON c.usuario_id = u.id
            INNER JOIN horarios_medicos h ON c.horario_id = h.id
            INNER JOIN establecimientos est ON c.establecimiento_id = est.id
            INNER JOIN especialidades esp ON c.especialidad_id = esp.id
            INNER JOIN medicos m ON h.medico_id = m.id
            WHERE u.dni = ? AND c.estado != 'CANCELADA'
            ORDER BY c.id DESC
        `;
        const [rows] = await db.query(query, [dni]);
        res.json(rows);
    } catch (err) {
        console.error("Error al obtener citas por DNI:", err);
        res.status(500).json({ error: err.message });
    }
});
// Obtener el ID de un usuario a partir de su DNI
app.get('/api/usuarios/dni/:dni', async (req, res) => {
    const { dni } = req.params;
    try {
        const [rows] = await db.query("SELECT id FROM usuarios WHERE dni = ?", [dni]);
        if (rows.length > 0) {
            res.json({ success: true, id: rows[0].id });
        } else {
            res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Obtener el total de citas por especialidad para el gráfico circular del Dashboard
app.get('/api/admin/grafico-especialidades', async (req, res) => {
    try {
        const query = `
            SELECT 
                esp.nombre as especialidad_nombre,
                COUNT(c.id) as total
            FROM citas c
            INNER JOIN especialidades esp ON c.especialidad_id = esp.id
            WHERE c.estado = 'RESERVADA'
            GROUP BY esp.id, esp.nombre
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error("Error al obtener gráfico de especialidades:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard-completo', async (req, res) => {
    try {
        // 1. Métricas de las Tarjetas Superiores
        const [totalCitas] = await db.query("SELECT COUNT(*) as total FROM citas");
        const [citasAtendidas] = await db.query("SELECT COUNT(*) as total FROM citas WHERE estado = 'ATENDIDA'");
        const [citasCanceladas] = await db.query("SELECT COUNT(*) as total FROM citas WHERE estado = 'CANCELADA'");
        const [citasInasistencia] = await db.query("SELECT COUNT(*) as total FROM citas WHERE estado = 'NO_ASISTIO'");
        const [citasReservadas] = await db.query("SELECT COUNT(*) as total FROM citas WHERE estado = 'RESERVADA'");

        const totalGral = totalCitas[0].total || 1; 
        const prog = totalGral; // Total general para el número grande
        const aten = citasAtendidas[0].total;
        const canc = citasCanceladas[0].total;
        const inas = citasInasistencia[0].total;
        const resv = citasReservadas[0].total; // <--- Cantidad real de citas activas

        const tasaInasistencia = ((inas / totalGral) * 100).toFixed(1);
        const pctAtendidas = ((aten / totalGral) * 100).toFixed(1);
        const pctCanceladas = ((canc / totalGral) * 100).toFixed(1);

        // 2. Citas por Especialidad (Para el Gráfico de Barras)
        const [porEspecialidad] = await db.query(`
            SELECT esp.nombre as especialidad_nombre, COUNT(c.id) as total
            FROM citas c
            JOIN especialidades esp ON c.especialidad_id = esp.id
            GROUP BY esp.id, esp.nombre
        `);

        // 3. Distribución por Estado (Para el Gráfico Circular / Donut)
        const distribucionEstados = {
            reservadas: prog,
            reprogramadas: await db.query("SELECT COUNT(*) as total FROM citas WHERE estado = 'REPROGRAMADA'").then(r => r[0][0].total),
            atendidas: aten,
            canceladas: canc,
            inasistencias: inas
        };

        res.json({
            tarjetas: {
                programadas: prog, // Total general (número grande)
                activas: resv,     // <--- Número real de activas para el subtítulo
                atendidas: aten,
                canceladas: canc,
                inasistencias: inas,
                tasaInasistencia: tasaInasistencia,
                pctAtendidas: pctAtendidas,
                pctCanceladas: pctCanceladas
            },
            porEspecialidad,
            distribucionEstados
        });

    } catch (err) {
        console.error("Error en dashboard completo:", err);
        res.status(500).json({ error: err.message });
    }
});