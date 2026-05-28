import axios from "axios";
import { toWorkerDto, fromWorkerDto, paginateWorkers } from "./workerMapper";
import { normalizePhone } from "../utils/phone";

const api = axios.create({
    baseURL: process.env.REACT_APP_API_BASE_URL || "http://localhost:8000/api/v1",
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
});

const publicApi = axios.create({
    baseURL: process.env.REACT_APP_API_BASE_URL || "http://localhost:8081/api/v1",
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
});

function extractErrorMessage(error) {
    if (error.message === "Network Error" || error.code === "ERR_NETWORK") {
        return "No se pudo conectar con el backend. Verifica que Spring Boot esté corriendo en el puerto 8081.";
    }
    if (error.response?.status === 403) {
        return "No tienes permiso para esta acción (403). Contacta al administrador.";
    }
    if (error.response?.status === 409) {
        const data = error.response?.data;
        if (typeof data === "string" && data.trim()) return data;
        return "El registro ya existe (409).";
    }
    if (error.response?.status === 405) {
        const method = error.config?.method?.toUpperCase() || "REQUEST";
        const url = `${error.config?.baseURL || ""}${error.config?.url || ""}`;
        return `Method Not Allowed (405): ${method} ${url}`;
    }
    const data = error.response?.data;
    if (typeof data === "string" && data.trim()) return data;
    return (
        data?.message ||
        data?.mensaje ||
        data?.error ||
        error.message ||
        "Error desconocido"
    );
}

api.interceptors.response.use(
    (res) => res,
    (error) => {
        if (error.response?.status === 401) {
            window.dispatchEvent(new CustomEvent("auth:unauthorized"));
        }
        return Promise.reject(new Error(extractErrorMessage(error)));
    }
);

publicApi.interceptors.response.use(
    (res) => res,
    (error) => Promise.reject(new Error(extractErrorMessage(error)))
);

export default api;

export const employeeService = {
    getAll: async (params = {}) => {
        const { data } = await api.get("/workers");
        const workers = (Array.isArray(data) ? data : []).map(fromWorkerDto);
        return { data: paginateWorkers(workers, params) };
    },

    getById: async (id) => {
        const { data } = await api.get(`/workers/${id}`);
        return { data: fromWorkerDto(data) };
    },

    create: async (payload) => {
        await api.post("/workers", toWorkerDto(payload));
        return { data: payload };
    },

    update: async (id, payload) => {
        await api.put(`/workers/${id}`, toWorkerDto(payload));
        return { data: { ...payload, id } };
    },

    delete: async (id) => {
        await api.delete(`/workers/${id}`);
        return { data: { message: "Eliminado" } };
    },
};

export const otpService = {
    sendPhone: (phone) =>
        publicApi.post("/verification/sms/send", undefined, {
            params: { phoneNumber: normalizePhone(phone) },
        }),

    verifyPhone: (phone, code) =>
        publicApi.post("/verification/sms/verify", undefined, {
            params: { phoneNumber: normalizePhone(phone), code },
        }),

    sendEmail: (email) =>
        publicApi.post("/verification/email/send", { email: email.trim() }),

    verifyEmail: (email, code) =>
        publicApi.post("/verification/email/verify", { email: email.trim(), code }),
};

export const parametersService = {
    get: () => api.get("/parametros"),
};
