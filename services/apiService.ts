const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001/api' : '/api';

class ApiService {
    private getHeaders() {
        const user = localStorage.getItem('auth_user');
        if (user) {
            const parsedUser = JSON.parse(user);
            // In a real app, the token should be stored separately or as part of the user object
            // For now, we assume the token is available or will be handled by the backend session
            // Given the backend middleware looks for a token, we might need to store it
            const token = localStorage.getItem('auth_token');
            return {
                'Content-Type': 'application/json',
                ...(token && { 'Authorization': `Bearer ${token}` })
            };
        }
        return { 'Content-Type': 'application/json' };
    }

    async get(endpoint: string) {
        const res = await fetch(`${API_URL}${endpoint}`, {
            headers: this.getHeaders()
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Fetch failed');
        return data.data;
    }

    async post(endpoint: string, body: any) {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Post failed');
        return data.data;
    }

    async put(endpoint: string, body: any) {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'PUT',
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Update failed');
        return data.data;
    }

    async delete(endpoint: string) {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'DELETE',
            headers: this.getHeaders()
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Delete failed');
        return data.data;
    }
}

export const apiService = new ApiService();
