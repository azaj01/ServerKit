import React, { useState } from 'react';
import Modal from '../Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

const CreateSiteModal = ({ onClose, onCreate }) => {
    const [formData, setFormData] = useState({
        name: '',
        domain: '',
        adminUser: 'admin',
        adminEmail: '',
        dbName: '',
        createDatabase: true
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    function handleChange(e) {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    }

    function generateDbName(siteName) {
        return `wp_${siteName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20)}`;
    }

    function handleNameChange(e) {
        const name = e.target.value;
        setFormData(prev => ({
            ...prev,
            name,
            dbName: prev.dbName || generateDbName(name)
        }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await onCreate({
                name: formData.name,
                domain: formData.domain,
                admin_user: formData.adminUser,
                admin_email: formData.adminEmail,
                db_name: formData.dbName,
                create_database: formData.createDatabase
            });
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create WordPress site');
        } finally {
            setLoading(false);
        }
    }

    return (
        <Modal open={true} onClose={onClose} title="Create WordPress Site">
            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <Label>Site Name *</Label>
                    <Input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleNameChange}
                        placeholder="My WordPress Site"
                        required
                    />
                </div>

                <div className="form-group">
                    <Label>Domain</Label>
                    <Input
                        type="text"
                        name="domain"
                        value={formData.domain}
                        onChange={handleChange}
                        placeholder="example.com"
                    />
                    <span className="form-hint">Leave empty to use a local development URL</span>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <Label>Admin Username *</Label>
                        <Input
                            type="text"
                            name="adminUser"
                            value={formData.adminUser}
                            onChange={handleChange}
                            placeholder="admin"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <Label>Admin Email *</Label>
                        <Input
                            type="email"
                            name="adminEmail"
                            value={formData.adminEmail}
                            onChange={handleChange}
                            placeholder="admin@example.com"
                            required
                        />
                    </div>
                </div>

                <div className="form-group">
                    <Label>Database Name</Label>
                    <Input
                        type="text"
                        name="dbName"
                        value={formData.dbName}
                        onChange={handleChange}
                        placeholder="wp_mysite"
                    />
                </div>

                <div className="form-group">
                    <label className="checkbox-label">
                        <Checkbox
                            name="createDatabase"
                            checked={formData.createDatabase}
                            onCheckedChange={(checked) =>
                                setFormData(prev => ({ ...prev, createDatabase: checked }))
                            }
                        />
                        <span>Create database automatically</span>
                    </label>
                </div>

                <div className="modal-actions">
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={loading}>
                        {loading ? 'Creating...' : 'Create Site'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default CreateSiteModal;
