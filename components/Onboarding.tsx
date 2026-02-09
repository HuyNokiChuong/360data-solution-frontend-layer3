import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';

interface OnboardingProps {
    currentUser: User;
    onUpdateUser: (user: User) => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ currentUser, onUpdateUser }) => {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        registrationType: 'Khách đăng ký',
        name: currentUser.name || '',
        email: currentUser.email || '',
        phoneNumber: currentUser.phoneNumber || '',
        currentLevel: '',
        department: '',
        industry: '',
        companySize: ''
    });

    // Verification State
    const [verificationCode, setVerificationCode] = useState(['', '', '', '', '', '']);
    const [timeLeft, setTimeLeft] = useState(60);
    const [canResend, setCanResend] = useState(false);

    useEffect(() => {
        if (step === 2 && timeLeft > 0) {
            const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
            return () => clearTimeout(timer);
        } else if (timeLeft === 0) {
            setCanResend(true);
        }
    }, [timeLeft, step]);

    const companySizes = [
        '1-10 employees',
        '11-50 employees',
        '51-200 employees',
        '201-500 employees',
        '501-1000 employees',
        '1000+ employees'
    ];

    const levels = [
        'Founder / CEO',
        'C-Level / VP',
        'Director / Head',
        'Manager / Lead',
        'Senior Specialist',
        'Staff / Associate',
        'Other'
    ];

    const departments = [
        'Data & Analytics',
        'Engineering / IT',
        'Marketing',
        'Sales / Business Development',
        'Finance / Accounting',
        'Operations',
        'Product Management',
        'Human Resources',
        'Legal / Compliance',
        'Other'
    ];

    const industries = [
        'Technology / SaaS',
        'Retail / E-commerce',
        'Financial Services',
        'Healthcare / Biotech',
        'Manufacturing',
        'Education',
        'Media / Entertainment',
        'Real Estate / Construction',
        'Logistics / Supply Chain',
        'Consulting / Services',
        'Other'
    ];

    const handleInputChange = (key: string, value: string) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    const handleFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Validate all required fields
        if (!formData.name || !formData.email || !formData.phoneNumber || !formData.currentLevel ||
            !formData.department || !formData.industry || !formData.companySize) {
            return; // Add proper error handling here if needed
        }
        setStep(2);
    };

    const handleVerifyAndSubmit = (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const code = verificationCode.join('');
        if (code.length !== 6) return;

        setLoading(true);
        // Simulate API verification
        setTimeout(() => {
            setLoading(false);
            // Save data
            const updatedUser: User = {
                ...currentUser,
                name: formData.name,
                email: formData.email,
                phoneNumber: formData.phoneNumber,
                currentLevel: formData.currentLevel,
                department: formData.department,
                industry: formData.industry,
                companySize: formData.companySize,
                registrationType: formData.registrationType,
                status: 'Active'
            };
            onUpdateUser(updatedUser);
        }, 1500);
    };

    const handleResendCode = () => {
        setCanResend(false);
        setTimeLeft(60);
        // Simulate resend API
        console.log("Resending code to:", formData.email);
    };

    const handleCodeChange = (index: number, value: string) => {
        if (value.length > 1) value = value[0];
        if (!/^\d*$/.test(value)) return;

        const newCode = [...verificationCode];
        newCode[index] = value;
        setVerificationCode(newCode);

        // Auto-focus next input
        if (value && index < 5) {
            const nextInput = document.getElementById(`code-${index + 1}`);
            nextInput?.focus();
        }
    };

    const handlePasteCode = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').slice(0, 6).split('');
        if (pastedData.length > 0) {
            const newCode = [...verificationCode];
            pastedData.forEach((char, index) => {
                if (index < 6 && /^\d$/.test(char)) {
                    newCode[index] = char;
                }
            });
            setVerificationCode(newCode);
        }
    };

    const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !verificationCode[index] && index > 0) {
            const prevInput = document.getElementById(`code-${index - 1}`);
            prevInput?.focus();
        }
    };

    const getProgressWidth = () => {
        return `${(step / 2) * 100}%`;
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#020617] flex items-center justify-center p-6 overflow-hidden relative">
            {/* Background Effects */}
            <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-indigo-600/10 blur-[150px] rounded-full animate-pulse duration-[5000ms]"></div>
            <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-blue-600/10 blur-[150px] rounded-full animate-pulse duration-[7000ms]"></div>

            <div className="w-full max-w-2xl relative z-10">
                {/* Progress Bar */}
                <div className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-full mb-8 overflow-hidden">
                    <div
                        className="h-full bg-indigo-600 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(79,70,229,0.5)]"
                        style={{ width: getProgressWidth() }}
                    ></div>
                </div>

                <div className="bg-white/80 dark:bg-slate-900/60 backdrop-blur-3xl p-8 md:p-12 rounded-[2.5rem] border border-slate-200 dark:border-white/5 shadow-2xl shadow-black/5 dark:shadow-black/50 animate-in fade-in zoom-in duration-500">

                    {/* Header */}
                    <div className="mb-8 text-center">
                        <span className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] mb-3 block">
                            Step {step} of 2
                        </span>
                        <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">
                            {step === 1 ? "Complete your profile" : "Check your email"}
                        </h2>
                        <p className="text-slate-500 font-medium text-sm">
                            {step === 1
                                ? "Please provide your details to personalize your workspace."
                                : `We've sent a 6-digit code to ${formData.email}`}
                        </p>
                    </div>

                    {/* Step 1: Registration Form */}
                    {step === 1 && (
                        <form onSubmit={handleFormSubmit} className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Type & Full Name */}
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Registration Type</label>
                                        <input
                                            type="text"
                                            readOnly
                                            value={formData.registrationType}
                                            className="w-full bg-slate-100 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-slate-500 cursor-not-allowed"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Full Name</label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={(e) => handleInputChange('name', e.target.value)}
                                            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:outline-none transition-all"
                                            placeholder="John Doe"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Email Address</label>
                                        <input
                                            type="email"
                                            required
                                            value={formData.email}
                                            onChange={(e) => handleInputChange('email', e.target.value)}
                                            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:outline-none transition-all"
                                            placeholder="john@company.com"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Phone Number</label>
                                        <input
                                            type="tel"
                                            required
                                            value={formData.phoneNumber}
                                            onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
                                            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:outline-none transition-all"
                                            placeholder="+84 ..."
                                        />
                                    </div>
                                </div>

                                {/* Selects */}
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Current Level</label>
                                        <select
                                            required
                                            value={formData.currentLevel}
                                            onChange={(e) => handleInputChange('currentLevel', e.target.value)}
                                            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:outline-none transition-all"
                                        >
                                            <option value="">Select Level</option>
                                            {levels.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Department</label>
                                        <select
                                            required
                                            value={formData.department}
                                            onChange={(e) => handleInputChange('department', e.target.value)}
                                            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:outline-none transition-all"
                                        >
                                            <option value="">Select Department</option>
                                            {departments.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Company Industry</label>
                                        <select
                                            required
                                            value={formData.industry}
                                            onChange={(e) => handleInputChange('industry', e.target.value)}
                                            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:outline-none transition-all"
                                        >
                                            <option value="">Select Industry</option>
                                            {industries.map(i => <option key={i} value={i}>{i}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Company Size</label>
                                        <select
                                            required
                                            value={formData.companySize}
                                            onChange={(e) => handleInputChange('companySize', e.target.value)}
                                            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:outline-none transition-all"
                                        >
                                            <option value="">Select Size</option>
                                            {companySizes.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-lg tracking-tight hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/20 active:scale-[0.98] mt-4"
                            >
                                Continue to Verification
                            </button>
                        </form>
                    )}

                    {/* Step 2: Verification */}
                    {step === 2 && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                            <form onSubmit={handleVerifyAndSubmit} className="space-y-8">
                                <div className="flex justify-between gap-2 md:gap-4 px-4" onPaste={handlePasteCode}>
                                    {verificationCode.map((digit, idx) => (
                                        <input
                                            key={idx}
                                            id={`code-${idx}`}
                                            type="text"
                                            maxLength={1}
                                            value={digit}
                                            onChange={(e) => handleCodeChange(idx, e.target.value)}
                                            onKeyDown={(e) => handleCodeKeyDown(idx, e)}
                                            className="w-full aspect-square md:w-16 md:h-20 rounded-2xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 text-center text-3xl font-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
                                            autoFocus={idx === 0}
                                        />
                                    ))}
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading || verificationCode.join('').length !== 6}
                                    className="w-full bg-emerald-500 text-white py-4 rounded-2xl font-black text-lg tracking-tight hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                                >
                                    {loading ? <i className="fas fa-circle-notch animate-spin"></i> : (
                                        <>
                                            <span>Verify & Complete Registration</span>
                                            <i className="fas fa-check-circle"></i>
                                        </>
                                    )}
                                </button>
                            </form>

                            <div className="mt-8 flex flex-col items-center gap-3">
                                <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">
                                    {timeLeft > 0
                                        ? `Resend available in ${timeLeft}s`
                                        : "Didn't receive the code?"}
                                </span>
                                {timeLeft === 0 && (
                                    <button
                                        onClick={handleResendCode}
                                        className="text-indigo-500 font-black hover:text-indigo-400 transition-colors uppercase tracking-widest text-[10px] bg-indigo-500/5 px-4 py-2 rounded-full border border-indigo-500/20"
                                    >
                                        Resend Verification Code
                                    </button>
                                )}
                            </div>

                            <button
                                onClick={() => setStep(1)}
                                className="mt-8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs font-black uppercase tracking-widest flex items-center gap-2 mx-auto transition-colors"
                            >
                                <i className="fas fa-arrow-left text-[10px]"></i>
                                Back to Edit Profile
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Onboarding;
