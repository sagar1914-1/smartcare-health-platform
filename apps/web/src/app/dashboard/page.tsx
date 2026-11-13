"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://api-sagar-b3a7.vercel.app/api/v1";

type HealthMetric =
  | "HEART_RATE"
  | "BLOOD_PRESSURE"
  | "SPO2"
  | "TEMPERATURE"
  | "WEIGHT";

type HealthRecord = {
  id: string;
  metric: HealthMetric;
  value: number;
  systolic?: number | null;
  diastolic?: number | null;
  unit: string;
  notes?: string | null;
  recordedAt: string;
};

type User = {
  id: string;
  name: string | null;
  email: string;
  role: "PATIENT" | "DOCTOR" | "ADMIN";
};

type IncidentStatus = "ACTIVE" | "RESOLVED" | "CANCELLED";

type Incident = {
  id: string;
  message?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: IncidentStatus;
  createdAt: string;
  resolvedAt?: string | null;
};

type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  relationship?: string | null;
  isPrimary: boolean;
  createdAt: string;
};

type NotificationStatus = "PENDING" | "SIMULATED" | "SENT" | "FAILED";

type EmergencyNotification = {
  id: string;
  recipientName: string;
  recipientPhone: string;
  channel: "SMS";
  status: NotificationStatus;
  message: string;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt: string;
  incidentId: string;
  incident: {
    status: IncidentStatus;
    createdAt: string;
  };
};

// Older mock-mode records were stored as SENT. Treat MOCK-prefixed IDs as
// simulated so the dashboard never presents them as real SMS messages.
function getNotificationDisplayStatus(
  notification: EmergencyNotification
): NotificationStatus {
  if (
    notification.status === "SIMULATED" ||
    (notification.status === "SENT" &&
      notification.providerMessageId?.startsWith("MOCK-"))
  ) {
    return "SIMULATED";
  }

  return notification.status;
}

// Validate phone numbers consistently with the backend contact schema.
function isValidPhoneNumber(phone: string): boolean {
  const normalizedPhone = phone.trim();

  if (!/^[+]?[0-9][0-9\s().-]*$/.test(normalizedPhone)) {
    return false;
  }

  const digitCount = normalizedPhone.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15;
}

const metricLabels: Record<HealthMetric, string> = {
  HEART_RATE: "Heart Rate",
  BLOOD_PRESSURE: "Blood Pressure",
  SPO2: "Blood Oxygen (SpO₂)",
  TEMPERATURE: "Temperature",
  WEIGHT: "Weight",
};

const defaultUnits: Record<HealthMetric, string> = {
  HEART_RATE: "bpm",
  BLOOD_PRESSURE: "mmHg",
  SPO2: "%",
  TEMPERATURE: "°C",
  WEIGHT: "kg",
};

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [notifications, setNotifications] = useState<EmergencyNotification[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [saving, setSaving] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);
  const [updatingIncidentId, setUpdatingIncidentId] = useState<string | null>(
    null
  );

  // Emergency contact form states
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactFormError, setContactFormError] = useState("");
  const [contactRelationship, setContactRelationship] = useState("");
  const [contactIsPrimary, setContactIsPrimary] = useState(false);

  const [editingContactId, setEditingContactId] = useState<string | null>(
    null
  );
  const [savingContact, setSavingContact] = useState(false);
  const [updatingContactId, setUpdatingContactId] = useState<string | null>(
    null
  );

  const [metric, setMetric] = useState<HealthMetric>("HEART_RATE");
  const [value, setValue] = useState("");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [unit, setUnit] = useState("bpm");
  const [notes, setNotes] = useState("");

  // AUTHENTICATED API REQUEST
  const apiRequest = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const token = sessionStorage.getItem("smartcare_token");

      if (!token) {
        router.replace("/login");
        throw new Error("Your session has expired. Please log in again.");
      }

      let response: Response;

      try {
        response = await fetch(`${API_URL}${path}`, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...options.headers,
          },
        });
      } catch {
        throw new Error(
          "Cannot connect to SmartCare server. Check whether the backend is running."
        );
      }

      const result = await response.json().catch(() => null);

      if (!response.ok || result?.success === false) {
        const errorDetails: string[] = [];

        if (result?.errors && typeof result.errors === "object") {
          for (const [field, messages] of Object.entries(result.errors)) {
            if (Array.isArray(messages)) {
              errorDetails.push(
                `${field}: ${messages.map(String).join(", ")}`
              );
            } else if (messages) {
              errorDetails.push(`${field}: ${String(messages)}`);
            }
          }
        }

        const mainMessage =
          result?.message || `Request failed with status ${response.status}.`;

        const completeMessage = errorDetails.length
          ? `${mainMessage} ${errorDetails.join(" ")}`
          : mainMessage;

        throw new Error(completeMessage);
      }

      return result;
    },
    [router]
  );

  // LOAD DASHBOARD DATA
  const loadDashboard = useCallback(async () => {
    try {
      setError("");

      const token = sessionStorage.getItem("smartcare_token");

      if (!token) {
        router.replace("/login");
        return;
      }

      const savedUser = sessionStorage.getItem("smartcare_user");

      if (savedUser) {
        try {
          setUser(JSON.parse(savedUser) as User);
        } catch {
          sessionStorage.removeItem("smartcare_user");
        }
      }

      const [
        recordsResult,
        incidentsResult,
        contactsResult,
        notificationsResult,
      ] = await Promise.all([
        apiRequest("/health/records"),
        apiRequest("/emergency/incidents"),
        apiRequest("/emergency/contacts"),
        apiRequest("/emergency/notifications"),
      ]);

      setRecords(
        Array.isArray(recordsResult.data) ? recordsResult.data : []
      );

      setIncidents(
        Array.isArray(incidentsResult.data) ? incidentsResult.data : []
      );

      setContacts(
        Array.isArray(contactsResult.data) ? contactsResult.data : []
      );

      setNotifications(
        Array.isArray(notificationsResult.data)
          ? notificationsResult.data
          : []
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load your dashboard."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiRequest, router]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // REFRESH
  async function handleRefresh() {
    setRefreshing(true);
    await loadDashboard();
  }

  // CHANGE HEALTH METRIC
  function handleMetricChange(nextMetric: HealthMetric) {
    setMetric(nextMetric);
    setUnit(defaultUnits[nextMetric]);
    setValue("");
    setSystolic("");
    setDiastolic("");
  }

  // ADD HEALTH RECORD
  async function handleAddRecord(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const numericValue = Number(value);
    const numericSystolic = Number(systolic);
    const numericDiastolic = Number(diastolic);

    if (metric === "BLOOD_PRESSURE") {
      if (
        !systolic.trim() || !diastolic.trim() ||
        !Number.isInteger(numericSystolic) ||
        !Number.isInteger(numericDiastolic) ||
        numericSystolic < 50 || numericSystolic > 300 ||
        numericDiastolic < 30 || numericDiastolic > 200
      ) {
        setError("Enter valid systolic (50–300) and diastolic (30–200) values in mmHg.");
        return;
      }
    } else if (!value.trim() || !Number.isFinite(numericValue)) {
      setError("Please enter a valid numeric reading.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const result = await apiRequest("/health/records", {
        method: "POST",
        body: JSON.stringify({
          metric,
          value: metric === "BLOOD_PRESSURE" ? numericSystolic : numericValue,
          ...(metric === "BLOOD_PRESSURE"
            ? { systolic: numericSystolic, diastolic: numericDiastolic }
            : {}),
          unit,
          notes,
        }),
      });

      if (result.data) {
        setRecords((current) => [
          result.data,
          ...current.filter((record) => record.id !== result.data.id),
        ]);
      } else {
        await loadDashboard();
      }

      setValue("");
      setSystolic("");
      setDiastolic("");
      setNotes("");
      setSuccess("Health record added successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save health record."
      );
    } finally {
      setSaving(false);
    }
  }

  // DELETE HEALTH RECORD
  async function handleDeleteRecord(id: string) {
    const confirmed = window.confirm(
      "Are you sure you want to delete this health record?"
    );

    if (!confirmed) return;

    try {
      setError("");
      setSuccess("");

      await apiRequest(`/health/records/${id}`, {
        method: "DELETE",
      });

      setRecords((current) =>
        current.filter((record) => record.id !== id)
      );

      setSuccess("Health record deleted successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not delete health record."
      );
    }
  }

  // CREATE EMERGENCY INCIDENT
  async function handleSOS() {
    const confirmed = window.confirm(
      "Are you sure you want to create an emergency incident? SmartCare will record it and may create simulated notification records. No emergency services are contacted, and mock mode does not send real SMS messages."
    );

    if (!confirmed) return;

    try {
      setSosLoading(true);
      setError("");
      setSuccess("");

      const result = await apiRequest("/emergency/incidents", {
        method: "POST",
        body: JSON.stringify({
          message: "Emergency assistance requested by user.",
        }),
      });

      if (result.data) {
        setIncidents((current) => [
          result.data,
          ...current.filter((incident) => incident.id !== result.data.id),
        ]);
      } else {
        await loadDashboard();
      }

      const notificationsResult = await apiRequest("/emergency/notifications");
      setNotifications(
        Array.isArray(notificationsResult.data)
          ? notificationsResult.data
          : []
      );

      setSuccess("Emergency incident recorded successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create emergency incident."
      );
    } finally {
      setSosLoading(false);
    }
  }

  // RESOLVE OR CANCEL AN INCIDENT
  async function handleIncidentStatus(
    incident: Incident,
    action: "resolve" | "cancel"
  ) {
    const actionLabel = action === "resolve" ? "resolve" : "cancel";

    const confirmed = window.confirm(
      `Are you sure you want to ${actionLabel} this emergency incident?`
    );

    if (!confirmed) return;

    try {
      setUpdatingIncidentId(incident.id);
      setError("");
      setSuccess("");

      const result = await apiRequest(
        `/emergency/incidents/${incident.id}/${action}`,
        {
          method: "PATCH",
        }
      );

      if (result.data) {
        setIncidents((current) =>
          current.map((item) =>
            item.id === incident.id ? result.data : item
          )
        );
      } else {
        await loadDashboard();
      }

      setSuccess(
        action === "resolve"
          ? "Emergency incident resolved successfully."
          : "Emergency incident cancelled successfully."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Could not ${actionLabel} emergency incident.`
      );
    } finally {
      setUpdatingIncidentId(null);
    }
  }

  // RESET EMERGENCY CONTACT FORM
  function resetContactForm() {
    setContactName("");
    setContactPhone("");
    setContactFormError("");
    setContactRelationship("");
    setContactIsPrimary(false);
    setEditingContactId(null);
  }

  // ADD OR UPDATE EMERGENCY CONTACT
  async function handleContactSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!contactName.trim() || !contactPhone.trim()) {
      const message = "Please enter the contact name and phone number.";
      setContactFormError(message);
      setError(message);
      return;
    }

    if (!isValidPhoneNumber(contactPhone)) {
      const message =
        "Please enter a valid phone number containing 7 to 15 digits. You may use a leading +, spaces, hyphens or parentheses.";
      setContactFormError(message);
      setError(message);
      return;
    }

    try {
      setSavingContact(true);
      setContactFormError("");
      setError("");
      setSuccess("");

      const isEditing = Boolean(editingContactId);

      const contactData = {
        name: contactName.trim(),
        phone: contactPhone.trim(),
        relationship: contactRelationship.trim() || undefined,
        isPrimary: contactIsPrimary,
      };

      const result = await apiRequest(
        isEditing
          ? `/emergency/contacts/${editingContactId}`
          : "/emergency/contacts",
        {
          method: isEditing ? "PATCH" : "POST",
          body: JSON.stringify(contactData),
        }
      );

      if (result.data) {
        const savedContact = result.data as EmergencyContact;

        setContacts((current) => {
          const updated = isEditing
            ? current.map((contact) =>
                contact.id === savedContact.id ? savedContact : contact
              )
            : [savedContact, ...current];

          return updated.map((contact) => ({
            ...contact,
            isPrimary: savedContact.isPrimary
              ? contact.id === savedContact.id
              : contact.isPrimary,
          }));
        });
      } else {
        const contactsResult = await apiRequest("/emergency/contacts");

        setContacts(
          Array.isArray(contactsResult.data) ? contactsResult.data : []
        );
      }

      resetContactForm();

      setSuccess(
        isEditing
          ? "Emergency contact updated successfully."
          : "Emergency contact added successfully."
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not save emergency contact.";
      setContactFormError(message);
      setError(message);
    } finally {
      setSavingContact(false);
    }
  }

  // EDIT EMERGENCY CONTACT
  function handleEditContact(contact: EmergencyContact) {
    setEditingContactId(contact.id);
    setContactName(contact.name);
    setContactPhone(contact.phone);
    setContactRelationship(contact.relationship || "");
    setContactIsPrimary(contact.isPrimary);

    setError("");
    setSuccess("");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // SET PRIMARY EMERGENCY CONTACT
  async function handleSetPrimaryContact(contact: EmergencyContact) {
    if (contact.isPrimary) return;

    try {
      setUpdatingContactId(contact.id);
      setError("");
      setSuccess("");

      await apiRequest(`/emergency/contacts/${contact.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          isPrimary: true,
        }),
      });

      const contactsResult = await apiRequest("/emergency/contacts");

      setContacts(
        Array.isArray(contactsResult.data) ? contactsResult.data : []
      );

      setSuccess(`${contact.name} is now your primary emergency contact.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not update primary contact."
      );
    } finally {
      setUpdatingContactId(null);
    }
  }

  // DELETE EMERGENCY CONTACT
  async function handleDeleteContact(id: string) {
    const confirmed = window.confirm(
      "Are you sure you want to delete this emergency contact?"
    );

    if (!confirmed) return;

    try {
      setUpdatingContactId(id);
      setError("");
      setSuccess("");

      await apiRequest(`/emergency/contacts/${id}`, {
        method: "DELETE",
      });

      setContacts((current) =>
        current.filter((contact) => contact.id !== id)
      );

      if (editingContactId === id) {
        resetContactForm();
      }

      setSuccess("Emergency contact deleted successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not delete emergency contact."
      );
    } finally {
      setUpdatingContactId(null);
    }
  }

  // LOG OUT
  function handleLogout() {
    sessionStorage.removeItem("smartcare_token");
    sessionStorage.removeItem("smartcare_user");
    router.replace("/login");
  }

  const activeIncidents = incidents.filter(
    (incident) => incident.status === "ACTIVE"
  ).length;

  // LOADING SCREEN
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-300">
          Loading your SmartCare dashboard...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8">
      <div className="mx-auto max-w-7xl">

        {/* HEADER */}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <p className="text-sm font-semibold text-cyan-400">
              SMARTCARE
            </p>

            <h1 className="mt-1 text-3xl font-bold">
              Health Dashboard
            </h1>

            <p className="mt-2 text-sm text-slate-400">
              Welcome, {user?.name || user?.email || "User"}
            </p>
          </div>

          <button
            onClick={handleLogout}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            Log out
          </button>
        </header>

        {/* ERROR MESSAGE */}
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
          >
            {error}
          </div>
        )}

        {/* SUCCESS MESSAGE */}
        {success && (
          <div
            role="status"
            className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300"
          >
            {success}
          </div>
        )}

        {/* DASHBOARD STATISTICS */}
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">
              Total health records
            </p>
            <p className="mt-3 text-3xl font-bold">
              {records.length}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">
              Total emergency incidents
            </p>
            <p className="mt-3 text-3xl font-bold">
              {incidents.length}
            </p>
            <p className="mt-1 text-xs text-amber-300">
              {activeIncidents} currently active
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">
              Account role
            </p>
            <p className="mt-3 text-2xl font-bold">
              {user?.role || "PATIENT"}
            </p>
          </div>

        </section>

        {/* ADD RECORD AND SOS */}
        <section className="mb-8 grid gap-6 lg:grid-cols-2">

          {/* ADD HEALTH RECORD */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">
              Add Health Reading
            </h2>

            <p className="mt-1 text-sm text-slate-400">
              Manually record a health measurement.
            </p>

            <form
              onSubmit={handleAddRecord}
              className="mt-6 space-y-4"
            >
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Health metric
                </label>

                <select
                  value={metric}
                  onChange={(e) =>
                    handleMetricChange(e.target.value as HealthMetric)
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                >
                  {Object.entries(metricLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {metric === "BLOOD_PRESSURE" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="systolic" className="mb-2 block text-sm text-slate-300">
                      Systolic (upper number)
                    </label>
                    <input
                      id="systolic"
                      type="number"
                      min="50"
                      max="300"
                      step="1"
                      inputMode="numeric"
                      value={systolic}
                      onChange={(e) => setSystolic(e.target.value)}
                      placeholder="e.g. 120"
                      required
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label htmlFor="diastolic" className="mb-2 block text-sm text-slate-300">
                      Diastolic (lower number)
                    </label>
                    <input
                      id="diastolic"
                      type="number"
                      min="30"
                      max="200"
                      step="1"
                      inputMode="numeric"
                      value={diastolic}
                      onChange={(e) => setDiastolic(e.target.value)}
                      placeholder="e.g. 80"
                      required
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                    />
                  </div>
                  <p className="col-span-2 text-xs text-slate-400">Enter both values in mmHg. Example: 120/80 mmHg.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-2 block text-sm text-slate-300">Reading</label>
                    <input
                      type="number"
                      step="any"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="Enter value"
                      required
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-slate-300">Unit</label>
                    <input
                      type="text"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Notes (optional)
                </label>

                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Add additional information..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Health Reading"}
              </button>
            </form>
          </div>

          {/* EMERGENCY SOS */}
          <div className="rounded-2xl border border-red-500/20 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">
              Emergency SOS
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Create an emergency incident record in your SmartCare
              account. Mock mode creates simulated notification records only;
              it does not send real SMS messages or contact emergency services.
            </p>

            <div className="my-8 flex justify-center">
              <button
                type="button"
                onClick={handleSOS}
                disabled={sosLoading}
                aria-label="Create emergency incident"
                className="flex h-36 w-36 items-center justify-center rounded-full border-8 border-red-500/20 bg-red-600 text-2xl font-bold shadow-xl shadow-red-900/30 transition hover:scale-105 hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sosLoading ? "SENDING..." : "SOS"}
              </button>
            </div>

            <p className="text-center text-xs text-slate-500">
              Demo incident recording only.
            </p>
          </div>

        </section>

        {/* RECENT HEALTH RECORDS */}
        <section className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">
                Recent Health Records
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                Your latest manually entered measurements.
              </p>
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {records.length === 0 ? (
            <p className="rounded-lg bg-slate-950 p-5 text-center text-sm text-slate-400">
              No health records yet. Add your first reading above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="border-b border-slate-700 text-slate-400">
                  <tr>
                    <th className="px-3 py-3">Metric</th>
                    <th className="px-3 py-3">Reading</th>
                    <th className="px-3 py-3">Notes</th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">Action</th>
                  </tr>
                </thead>

                <tbody>
                  {records.map((record) => (
                    <tr
                      key={record.id}
                      className="border-b border-slate-800 last:border-0"
                    >
                      <td className="px-3 py-4">
                        {metricLabels[record.metric] || record.metric}
                      </td>

                      <td className="px-3 py-4 font-semibold">
                        {record.metric === "BLOOD_PRESSURE"
                          ? record.systolic != null && record.diastolic != null
                            ? `${record.systolic}/${record.diastolic} mmHg`
                            : `${record.value} ${record.unit} (legacy record)`
                          : `${record.value} ${record.unit}`}
                      </td>

                      <td className="px-3 py-4 text-slate-400">
                        {record.notes || "—"}
                      </td>

                      <td className="px-3 py-4 text-slate-400">
                        {new Date(record.recordedAt).toLocaleString()}
                      </td>

                      <td className="px-3 py-4">
                        <button
                          onClick={() => handleDeleteRecord(record.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </section>

        {/* EMERGENCY CONTACTS */}
        <section className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">

          <div className="mb-6">
            <h2 className="text-xl font-semibold">
              Emergency Contacts
            </h2>

            <p className="mt-1 text-sm text-slate-400">
              Save the people who should be contacted in an emergency.
            </p>
          </div>

          {/* ADD OR EDIT CONTACT FORM */}
          <form
            onSubmit={handleContactSubmit}
            className="mb-8 space-y-4"
          >

            <div className="grid gap-4 sm:grid-cols-2">

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Contact Name
                </label>

                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Enter full name"
                  required
                  maxLength={100}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Phone Number
                </label>

                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => {
                    setContactPhone(e.target.value);
                    setContactFormError("");
                  }}
                  placeholder="e.g. +919876543210"
                  required
                  maxLength={20}
                  autoComplete="tel"
                  aria-describedby="contact-phone-help"
                  title="Enter 7 to 15 digits. A leading +, spaces, hyphens and parentheses are allowed."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                />
                <p id="contact-phone-help" className="mt-1 text-xs text-slate-500">
                  Enter 7–15 digits. Example: +919876543210.
                </p>
                {contactFormError && (
                  <p
                    role="alert"
                    className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
                  >
                    {contactFormError}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Relationship
                </label>

                <input
                  type="text"
                  value={contactRelationship}
                  onChange={(e) => setContactRelationship(e.target.value)}
                  placeholder="e.g. Father, Mother, Friend"
                  maxLength={50}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                />
              </div>

            </div>

            <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={contactIsPrimary}
                onChange={(e) => setContactIsPrimary(e.target.checked)}
                className="h-4 w-4 accent-cyan-500"
              />

              Set as primary emergency contact
            </label>

            <div className="flex flex-wrap gap-3">

              <button
                type="submit"
                disabled={savingContact}
                className="rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
              >
                {savingContact
                  ? "Saving..."
                  : editingContactId
                    ? "Update Contact"
                    : "Add Emergency Contact"}
              </button>

              {editingContactId && (
                <button
                  type="button"
                  onClick={resetContactForm}
                  className="rounded-lg border border-slate-700 px-5 py-3 text-sm text-slate-300 transition hover:bg-slate-800"
                >
                  Cancel Editing
                </button>
              )}

            </div>

          </form>

          {/* SAVED CONTACTS */}
          <div className="border-t border-slate-800 pt-6">

            <h3 className="mb-4 text-lg font-semibold">
              Saved Emergency Contacts ({contacts.length})
            </h3>

            {contacts.length === 0 ? (
              <p className="rounded-lg bg-slate-950 p-5 text-center text-sm text-slate-400">
                No emergency contacts added yet. Add your first contact above.
              </p>
            ) : (

              <div className="space-y-3">

                {contacts.map((contact) => (

                  <div
                    key={contact.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4"
                  >

                    <div className="min-w-0 flex-1">

                      <div className="flex flex-wrap items-center gap-2">

                        <p className="font-semibold text-white">
                          {contact.name}
                        </p>

                        {contact.isPrimary && (
                          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                            Primary Contact
                          </span>
                        )}

                      </div>

                      <p className="mt-2 text-sm text-slate-300">
                        {contact.phone}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        {contact.relationship || "Relationship not specified"}
                      </p>

                    </div>

                    <div className="flex flex-wrap items-center gap-2">

                      {!contact.isPrimary && (
                        <button
                          type="button"
                          onClick={() => handleSetPrimaryContact(contact)}
                          disabled={updatingContactId === contact.id}
                          className="rounded-lg bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-600/30 disabled:opacity-50"
                        >
                          {updatingContactId === contact.id
                            ? "Updating..."
                            : "Make Primary"}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleEditContact(contact)}
                        className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteContact(contact.id)}
                        disabled={updatingContactId === contact.id}
                        className="rounded-lg bg-red-600/10 px-3 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-600/20 disabled:opacity-50"
                      >
                        {updatingContactId === contact.id
                          ? "Updating..."
                          : "Delete"}
                      </button>

                    </div>

                  </div>

                ))}

              </div>

            )}

          </div>

        </section>

        {/* EMERGENCY INCIDENT HISTORY */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">
                Emergency Incident History
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                View and manage your recorded emergency incidents.
              </p>
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {incidents.length === 0 ? (
            <p className="rounded-lg bg-slate-950 p-5 text-center text-sm text-slate-400">
              No emergency incidents recorded.
            </p>
          ) : (
            <div className="space-y-3">
              {incidents.map((incident) => (
                <div
                  key={incident.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {incident.message || "Emergency incident"}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      Created: {new Date(incident.createdAt).toLocaleString()}
                    </p>

                    {incident.resolvedAt && (
                      <p className="mt-1 text-xs text-slate-500">
                        Updated: {new Date(incident.resolvedAt).toLocaleString()}
                      </p>
                    )}

                    {incident.latitude != null &&
                      incident.longitude != null && (
                        <p className="mt-1 text-xs text-slate-500">
                          Location: {incident.latitude}, {incident.longitude}
                        </p>
                      )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        incident.status === "ACTIVE"
                          ? "bg-amber-500/10 text-amber-300"
                          : incident.status === "RESOLVED"
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-slate-500/10 text-slate-300"
                      }`}
                    >
                      {incident.status}
                    </span>

                    {incident.status === "ACTIVE" && (
                      <>
                        <button
                          onClick={() =>
                            handleIncidentStatus(incident, "resolve")
                          }
                          disabled={updatingIncidentId === incident.id}
                          className="rounded-lg bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-600/30 disabled:opacity-50"
                        >
                          {updatingIncidentId === incident.id
                            ? "Updating..."
                            : "Resolve"}
                        </button>

                        <button
                          onClick={() =>
                            handleIncidentStatus(incident, "cancel")
                          }
                          disabled={updatingIncidentId === incident.id}
                          className="rounded-lg bg-red-600/20 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-600/30 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        </section>

        {/* EMERGENCY NOTIFICATION HISTORY */}
        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">
                Emergency Notification History
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Review notification records created for your emergency contacts.
              </p>
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {notifications.length === 0 ? (
            <p className="rounded-lg bg-slate-950 p-5 text-center text-sm text-slate-400">
              No notification records found. Notification history will appear
              here when an emergency incident is recorded and contacts exist.
            </p>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="rounded-xl border border-slate-800 bg-slate-950 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white">
                        {notification.recipientName}
                      </p>
                      <p className="mt-1 text-sm text-slate-300">
                        {notification.recipientPhone}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Channel: {notification.channel} · Created:{" "}
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Related incident: {notification.incidentId}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Incident status: {notification.incident.status}
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        getNotificationDisplayStatus(notification) === "SENT"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : getNotificationDisplayStatus(notification) === "SIMULATED"
                            ? "bg-sky-500/10 text-sky-300"
                            : getNotificationDisplayStatus(notification) === "FAILED"
                              ? "bg-red-500/10 text-red-300"
                              : "bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {getNotificationDisplayStatus(notification)}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {notification.message}
                  </p>

                  {notification.sentAt &&
                    getNotificationDisplayStatus(notification) === "SENT" && (
                      <p className="mt-2 text-xs text-emerald-300">
                        Accepted by SMS provider:{" "}
                        {new Date(notification.sentAt).toLocaleString()}
                      </p>
                    )}

                  {getNotificationDisplayStatus(notification) === "SIMULATED" && (
                    <p className="mt-2 text-xs text-sky-300">
                      Simulation only — no SMS was sent to this contact.
                    </p>
                  )}

                  {notification.providerMessageId && (
                    <p className="mt-1 break-all text-xs text-slate-500">
                      Provider message ID: {notification.providerMessageId}
                    </p>
                  )}

                  {notification.errorMessage && (
                    <p
                      className={`mt-2 rounded-lg border p-3 text-xs ${
                        getNotificationDisplayStatus(notification) === "SIMULATED"
                          ? "border-sky-500/20 bg-sky-500/10 text-sky-300"
                          : "border-red-500/20 bg-red-500/10 text-red-300"
                      }`}
                    >
                      {notification.errorMessage}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="mt-4 text-xs leading-5 text-slate-500">
            SIMULATED means SmartCare created a test notification record only;
            no SMS was sent. PENDING means no send attempt has been completed.
            SENT means the real SMS provider accepted the request, but this does
            not confirm delivery to the recipient's phone. Older mock records
            are also identified as SIMULATED using their MOCK provider ID.
          </p>
        </section>

        <footer className="py-8 text-center text-xs text-slate-500">
          SmartCare Health Platform · MVP Demo
        </footer>

      </div>
    </main>
  );
}
