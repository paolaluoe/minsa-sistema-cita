const API_URL = 'http://localhost:3000/api';

document.addEventListener('DOMContentLoaded', () => {
    cargarEstablecimientos();
});

async function cargarEstablecimientos() {
    try {
        const res = await fetch(`${API_URL}/establecimientos`);
        const datos = await res.json();
        const select = document.getElementById('selectEstablecimiento');
        if (select) {
            select.innerHTML = '<option value="" selected disabled>Seleccione un centro de salud</option>';
            datos.forEach(e => {
                select.innerHTML += `<option value="${e.id}">${e.nombre}</option>`;
            });
        }
    } catch (err) {
        console.error('Error al conectar con la API:', err);
    }
}