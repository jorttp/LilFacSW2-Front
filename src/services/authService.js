import axios from "axios";

const KEYCLOAK_URL    = process.env.REACT_APP_KEYCLOAK_URL || "http://localhost:8090";
const REALM           = process.env.REACT_APP_KEYCLOAK_REALM         || "lilfac";
const CLIENT_ID       = process.env.REACT_APP_KEYCLOAK_CLIENT_ID     || "lilfac-api";
const CLIENT_SECRET   = process.env.REACT_APP_KEYCLOAK_CLIENT_SECRET || "psaUCh3pn7HUolNFcO4R1JknvLZLud77";

const TOKEN_URL = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;

const ROLE_PRIORITY = ["ADMIN", "CAJA", "BODEGA", "LOGISTICA"];
const KEYCLOAK_SYSTEM_ROLES = /^(default-roles-|offline_access$|uma_authorization$)/;

function parseJwt(token) {
    try {
        const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(base64));
    } catch {
        throw new Error("Token inválido recibido de Keycloak");
    }
}

function collectRoles(payload) {
    const realmRoles  = payload?.realm_access?.roles || [];
    const clientRoles = payload?.resource_access?.[CLIENT_ID]?.roles || [];
    return [...new Set([...realmRoles, ...clientRoles])]
        .filter((role) => !KEYCLOAK_SYSTEM_ROLES.test(role));
}

function extractRole(payload) {
    const roles = collectRoles(payload);
    return ROLE_PRIORITY.find((r) => roles.includes(r)) || roles[0] || "USER";
}

function extractKeycloakError(error) {
    const data = error.response?.data;

    if (typeof data?.error_description === "string" && data.error_description.trim()) {
        return data.error_description;
    }

    switch (data?.error) {
        case "invalid_grant":
            return "Usuario o contraseña incorrectos";
        case "invalid_client":
            return "Cliente Keycloak inválido. Revisa REACT_APP_KEYCLOAK_CLIENT_ID y REACT_APP_KEYCLOAK_CLIENT_SECRET en .env";
        case "unauthorized_client":
            return "El cliente lilfac-api no permite login directo. En Keycloak activa 'Direct Access Grants' y verifica el client_secret";
        default:
            break;
    }

    if (error.response?.status === 405) {
        return "Method Not Allowed (405). Verifica REACT_APP_KEYCLOAK_URL en .env.";
    }

    return error.message || "Error de autenticación con Keycloak";
}

function wrapNetworkError(error, service) {
    if (error.message === "Network Error" || error.code === "ERR_NETWORK") {
        return new Error(
            `No se pudo conectar con ${service}. ` +
            "Verifica que esté corriendo y reinicia el frontend (npm start)."
        );
    }
    return error;
}

function appendClientCredentials(params) {
    params.append("client_id", CLIENT_ID);
}

function buildAuthHeader() {
    if (!CLIENT_SECRET) return {};
    const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
    return { Authorization: `Basic ${credentials}` };
}

async function requestToken(params) {
    if (!CLIENT_SECRET) {
        throw new Error(
            "Falta REACT_APP_KEYCLOAK_CLIENT_SECRET en .env. " +
            "Cópialo desde Keycloak → Clients → lilfac-api → Credentials y reinicia npm start."
        );
    }

    try {
        const { data } = await axios.post(TOKEN_URL, params, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                ...buildAuthHeader(),
            },
            timeout: 15000,
        });
        return data;
    } catch (error) {
        throw new Error(extractKeycloakError(wrapNetworkError(error, "Keycloak")));
    }
}

function mapTokenResponse(data, fallbackUsername) {
    const payload = parseJwt(data.access_token);

    return {
        token:        data.access_token,
        refreshToken: data.refresh_token || null,
        expiresIn:    data.expires_in,
        user: {
            id:       payload.sub,
            username: payload.preferred_username || payload.email || fallbackUsername,
            email:    payload.email || null,
            role:     extractRole(payload),
            roles:    collectRoles(payload),
        },
    };
}

export const authService = {
    login: async (username, password) => {
        const params = new URLSearchParams();
        appendClientCredentials(params);
        params.append("grant_type", "password");
        params.append("username", username);
        params.append("password", password);
        params.append("scope", "openid profile email roles");

        const data = await requestToken(params);
        return mapTokenResponse(data, username);
    },

    refresh: async (refreshToken) => {
        if (!refreshToken) {
            throw new Error("No hay refresh token disponible");
        }

        const params = new URLSearchParams();
        appendClientCredentials(params);
        params.append("grant_type", "refresh_token");
        params.append("refresh_token", refreshToken);

        const data = await requestToken(params);
        return mapTokenResponse(data);
    },
};
