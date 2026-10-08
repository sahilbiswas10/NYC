const API_URL = '/api';

const getHeaders = () => {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
};

const apiCall = async (endpoint, options = {}) => {
    try {
        const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
        const headers = isFormData
            ? { ...(localStorage.getItem('token') ? { Authorization: `Bearer ${localStorage.getItem('token')}` } : {}), ...options.headers }
            : { ...getHeaders(), ...options.headers };
        const res = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });
        const contentType = res.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await res.json() : { error: await res.text() };
        if (!res.ok) {
            if (res.status === 401 && !['/auth/login', '/auth/password'].includes(endpoint)) {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
                const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                if (!['/login.html', '/register.html'].includes(window.location.pathname)) {
                    window.location.replace(`/login.html?returnTo=${encodeURIComponent(currentPath)}`);
                }
            }
            const error = new Error(data.error || 'API Error');
            error.status = res.status;
            throw error;
        }
        return data;
    } catch (err) {
        if (err instanceof TypeError && !err.status) throw new Error('Unable to reach the server. Check your connection and try again.');
        throw err;
    }
};

window.apiCall = apiCall;

window.openProtectedFile = async (loadFile) => {
    const target = window.open('about:blank', '_blank');
    try {
        const blob = await loadFile();
        const url = URL.createObjectURL(blob);
        if (target) target.location.href = url;
        else {
            const link = document.createElement('a'); link.href = url; link.download = 'module-notes'; link.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (error) {
        target?.close();
        throw error;
    }
};

window.api = {
    auth: {
        login: (credentials) => apiCall('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
        register: (userData) => apiCall('/auth/register', { method: 'POST', body: JSON.stringify(userData) }),
        getMe: () => apiCall('/auth/me'),
        updateProfile: (data) => apiCall('/auth/update', { method: 'PUT', body: JSON.stringify(data) }),
        updatePassword: (data) => apiCall('/auth/password', { method: 'PUT', body: JSON.stringify(data) }),
        logout: () => apiCall('/auth/logout', { method: 'POST' })
    },
    courses: {
        getAll: () => apiCall('/courses'),
        getById: (id) => apiCall(`/courses/${id}`),
        enroll: (id) => apiCall(`/courses/${id}/enroll`, { method: 'POST' }),
        create: (data) => apiCall('/courses', { method: 'POST', body: JSON.stringify(data) }),
        update: (id, data) => apiCall(`/courses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
        uploadThumbnail: (id, file) => { const form = new FormData(); form.append('thumbnail', file); return apiCall(`/courses/${id}/thumbnail`, { method: 'POST', body: form }); },
        delete: (id) => apiCall(`/courses/${id}`, { method: 'DELETE' }),
        getModules: (id) => apiCall(`/courses/${id}/modules`)
    },
    modules: {
        create: (courseId, data) => apiCall(`/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify(data) }),
        update: (courseId, moduleId, data) => apiCall(`/courses/${courseId}/modules/${moduleId}`, { method: 'PUT', body: JSON.stringify(data) }),
        delete: (courseId, moduleId) => apiCall(`/courses/${courseId}/modules/${moduleId}`, { method: 'DELETE' }),
        getLessons: (moduleId) => apiCall(`/modules/${moduleId}/lessons`),
        uploadNotes: (courseId, moduleId, formData) => apiCall(`/courses/${courseId}/modules/${moduleId}/notes`, { method: 'POST', body: formData }),
        deleteNotes: (courseId, moduleId) => apiCall(`/courses/${courseId}/modules/${moduleId}/notes`, { method: 'DELETE' }),
        getNotes: async (courseId, moduleId) => {
            const res = await fetch(`${API_URL}/courses/${courseId}/modules/${moduleId}/notes`, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
            if (!res.ok) {
                let message = 'Unable to open module notes';
                try { message = (await res.json()).error || message; } catch (error) {}
                throw new Error(message);
            }
            return res.blob();
        }
    },
    lessons: {
        create: (moduleId, data) => apiCall(`/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify(data) }),
        update: (moduleId, lessonId, data) => apiCall(`/modules/${moduleId}/lessons/${lessonId}`, { method: 'PUT', body: JSON.stringify(data) }),
        delete: (moduleId, lessonId) => apiCall(`/modules/${moduleId}/lessons/${lessonId}`, { method: 'DELETE' })
    },
    media: {
        getAll: () => apiCall('/media'),
        upload: (formData) => apiCall('/media/upload', { method: 'POST', body: formData }),
        getStatus: (id) => apiCall(`/media/${id}/status`),
        delete: (id) => apiCall(`/media/${id}`, { method: 'DELETE' })
    },
    student: {
        getEnrolled: () => apiCall('/student/courses'),
        getContinueWatching: () => apiCall('/student/continue-watching'),
        getCompletedCourses: () => apiCall('/student/completed-courses')
    },
    admin: {
        getCourses: () => apiCall('/courses/admin'),
        getUsers: () => apiCall('/admin/users'),
        updateUser: (id, data) => apiCall(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
        deleteUser: (id) => apiCall(`/admin/users/${id}`, { method: 'DELETE' }),
        setRole: (id, role) => apiCall(`/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
        getInstructors: () => apiCall('/admin/instructors'),
        createInstructor: (formData) => apiCall('/admin/instructors', { method: 'POST', body: formData }),
        updateInstructor: (id, formData) => apiCall(`/admin/instructors/${id}`, { method: 'PUT', body: formData }),
        deleteInstructor: (id) => apiCall(`/admin/instructors/${id}`, { method: 'DELETE' })
    },
    instructors: {
        getAll: () => apiCall('/instructors'),
        getById: (id) => apiCall(`/instructors/${id}`)
    },
    payments: {
        createOrder: (courseId) => apiCall(`/payments/courses/${encodeURIComponent(courseId)}/order`, { method: 'POST' }),
        verify: (data) => apiCall('/payments/verify', { method: 'POST', body: JSON.stringify(data) })
    },
    discussions: {
        getForCourse: (courseId) => apiCall(`/courses/${encodeURIComponent(courseId)}/discussions`),
        postToCourse: (courseId, data) => apiCall(`/courses/${encodeURIComponent(courseId)}/discussions`, { method: 'POST', body: JSON.stringify(data) })
    }
};
