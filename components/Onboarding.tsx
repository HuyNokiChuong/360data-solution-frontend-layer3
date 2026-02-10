import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';
import { emailService } from '../services/emailService';
import { authApi, setAuthToken } from '../services/apiClient';

interface OnboardingProps {
    currentUser: User;
    onUpdateUser: (user: User) => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ currentUser, onUpdateUser }) => {
    const navigate = useNavigate();
    const [step, setStep] = useState(() => {
        // If we already have the basic info from registration, go straight to verification
        if (currentUser.phoneNumber && currentUser.level) return 4;
        return 1;
    });
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        jobTitle: currentUser.jobTitle || '',
        phoneNumber: currentUser.phoneNumber || '',
        companySize: currentUser.companySize || '',
        level: currentUser.level || '',
        department: currentUser.department || '',
        industry: currentUser.industry || ''
    });

    // Verification State
    const [verificationCode, setVerificationCode] = useState(['', '', '', '', '', '']);
    const [sentCode, setSentCode] = useState<string>(''); // The actual code sent to email
    const [timeLeft, setTimeLeft] = useState(60);
    const [canResend, setCanResend] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Generate and send code on step 4 - Backend already sent it on register for first time.
    // So ONLY trigger if this is a "Resend" action, not auto on mount.
    // Wait, if user refreshed, pendingUser is loaded from local storage.
    // But backend code might have expired or user might need resend.
    // Let's assume if they land here, they should check email.
    // If they click "Resend", then we call API.

    // We remove the auto-trigger effect because registration (step 0 effectively) triggered it.
    // If we want to be safe, we could have a check, but backend handles initial send.

    const triggerEmail = async () => {
        setLoading(true);
        try {
            await authApi.resendCode({ email: currentUser.email });
        } catch (e) {
            console.error('Failed to trigger email:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (step === 4 && timeLeft > 0) {
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
        '500+ employees'
    ];

    const roles = [
        'Founder / CEO',
        'CTO / VP of Engineering',
        'Data Scientist / Analyst',
        'Product Manager',
        'Software Engineer',
        'Marketing / Growth',
        'Other'
    ];

    const handleSelectOption = (key: string, value: string) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    const handleVerifyAndSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const code = verificationCode.join('');
        if (code.length !== 6) return;

        setErrorMessage(null);
        setLoading(true);

        authApi.verify({ email: currentUser.email, code })
            .then((data) => {
                // Store JWT token from verify response
                if (data.data?.token) {
                    setAuthToken(data.data.token);
                }

                // Save data
                const updatedUser: User = {
                    ...currentUser,
                    ...formData,
                    id: data.data?.user?.id || currentUser.id,
                    status: 'Active'
                };
                onUpdateUser(updatedUser);
            })
            .catch(err => {
                setErrorMessage(err.message || "Mã xác thực không hợp lệ");
            })
            .finally(() => setLoading(false));
    };

    const nextStep = () => {
        if (step < 4) setStep(step + 1);
    };

    const handleResendCode = async () => {
        setCanResend(false);
        setTimeLeft(60);
        setErrorMessage(null);
        setVerificationCode(['', '', '', '', '', '']);

        try {
            await authApi.resendCode({ email: currentUser.email });
        } catch (err: any) {
            setErrorMessage(err.message || "Failed to resend code");
            setCanResend(true);
        }
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
        return `${(step / 4) * 100}%`;
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#020617] flex items-center justify-center p-6 overflow-hidden relative">
            {/* Background Effects */}
            <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-indigo-600/10 blur-[150px] rounded-full animate-pulse duration-[5000ms]"></div>
            <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-blue-600/10 blur-[150px] rounded-full animate-pulse duration-[7000ms]"></div>

            <div className="w-full max-w-4xl relative z-10 transition-all duration-500">
                {/* Progress Bar */}
                <div className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-full mb-12 overflow-hidden">
                    <div
                        className="h-full bg-indigo-600 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(79,70,229,0.5)]"
                        style={{ width: step === 4 ? '100%' : getProgressWidth() }}
                    ></div>
                </div>

                <div className="bg-white/80 dark:bg-slate-900/60 backdrop-blur-3xl p-10 md:p-14 rounded-[3rem] border border-slate-200 dark:border-white/5 shadow-2xl shadow-black/5 dark:shadow-black/50 animate-in fade-in zoom-in duration-500">

                    {/* Header */}
                    <div className="mb-10 text-center">
                        <span className="text-xs font-black text-indigo-500 uppercase tracking-[0.2em] mb-3 block">
                            {step === 4 ? "Final Step" : `Step ${step} of 4`}
                        </span>
                        <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white mb-4 tracking-tight">
                            {step === 1 && "What is your primary role?"}
                            {step === 2 && "How large is your organization?"}
                            {step === 3 && "Let's stay in touch"}
                            {step === 4 && "Verify your Security Code"}
                        </h2>
                        <p className="text-slate-500 font-medium text-lg">
                            {step === 1 && "Help us tailor the experience to your needs."}
                            {step === 2 && "We'll optimize the data capacity for your team."}
                            {step === 3 && "Secure your account with verified contact info."}
                            {step === 4 && (
                                <span>
                                    We've sent a 6-digit verification code to <span className="text-indigo-600 font-bold">{currentUser.email}</span>. Please enter it below to complete your setup.
                                </span>
                            )}
                        </p>
                    </div>

                    {/* Step 1: Role */}
                    {step === 1 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-right-8 duration-300">
                            {roles.map(role => (
                                <button
                                    key={role}
                                    onClick={() => {
                                        handleSelectOption('jobTitle', role);
                                        setTimeout(nextStep, 200);
                                    }}
                                    className={`p-5 rounded-2xl border text-left transition-all group relative overflow-hidden ${formData.jobTitle === role
                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                                        : 'bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:bg-slate-50 dark:hover:bg-white/5'
                                        }`}
                                >
                                    <span className={`text-base font-bold ${formData.jobTitle === role ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                                        {role}
                                    </span>
                                    {formData.jobTitle === role && (
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                            <i className="fas fa-check-circle text-white/90"></i>
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Step 2: Company Size */}
                    {step === 2 && (
                        <div className="space-y-4 animate-in slide-in-from-right-8 duration-300">
                            {companySizes.map(size => (
                                <button
                                    key={size}
                                    onClick={() => {
                                        handleSelectOption('companySize', size);
                                        setTimeout(nextStep, 200);
                                    }}
                                    className={`w-full p-6 rounded-2xl border text-left flex items-center justify-between transition-all group ${formData.companySize === size
                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20 scale-[1.02]'
                                        : 'bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:bg-slate-50 dark:hover:bg-white/5'
                                        }`}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${formData.companySize === size
                                            ? 'bg-white/20 text-white'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                                            }`}>
                                            <i className="fas fa-building"></i>
                                        </div>
                                        <span className={`text-lg font-bold ${formData.companySize === size ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {size}
                                        </span>
                                    </div>
                                    {formData.companySize === size && (
                                        <i className="fas fa-arrow-right text-white"></i>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Step 3: Phone Number */}
                    {step === 3 && (
                        <form onSubmit={(e) => { e.preventDefault(); nextStep(); }} className="animate-in slide-in-from-right-8 duration-300">
                            <div className="mb-8">
                                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3 px-1">
                                    Phone Number
                                </label>
                                <div className="relative">
                                    <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400">
                                        <i className="fas fa-phone"></i>
                                    </div>
                                    <input
                                        type="tel"
                                        required
                                        value={formData.phoneNumber}
                                        onChange={(e) => handleSelectOption('phoneNumber', e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl pl-14 pr-6 py-5 text-lg font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700"
                                        placeholder="+1 (555) 000-0000"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={!formData.phoneNumber}
                                className="w-full bg-indigo-600 text-white py-5 rounded-[1.5rem] font-black text-lg tracking-tight hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                            >
                                <span>Continue</span>
                                <i className="fas fa-arrow-right"></i>
                            </button>
                        </form>
                    )}

                    {/* Step 4: Verification */}
                    {step === 4 && (
                        <div className="animate-in slide-in-from-right-8 duration-300">
                            <form onSubmit={handleVerifyAndSubmit} className="space-y-8">
                                <div className="flex justify-between gap-2" onPaste={handlePasteCode}>
                                    {verificationCode.map((digit, idx) => (
                                        <input
                                            key={idx}
                                            id={`code-${idx}`}
                                            type="text"
                                            maxLength={1}
                                            value={digit}
                                            onChange={(e) => handleCodeChange(idx, e.target.value)}
                                            onKeyDown={(e) => handleCodeKeyDown(idx, e)}
                                            className="w-12 h-14 md:w-16 md:h-20 rounded-2xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 text-center text-3xl font-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all caret-indigo-500 shadow-sm"
                                            autoFocus={idx === 0}
                                        />
                                    ))}
                                </div>
                                {errorMessage && (
                                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                                        <i className="fas fa-exclamation-circle text-red-500"></i>
                                        <span className="text-red-500 text-xs font-bold">{errorMessage}</span>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading || verificationCode.join('').length !== 6}
                                    className="w-full bg-emerald-500 text-white py-5 rounded-[1.5rem] font-black text-lg tracking-tight hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                                >
                                    {loading ? <i className="fas fa-circle-notch animate-spin"></i> : (
                                        <>
                                            <span>Verify & Complete</span>
                                            <i className="fas fa-check-circle"></i>
                                        </>
                                    )}
                                </button>
                            </form>

                            <div className="mt-8 flex flex-col items-center gap-3">
                                <span className="text-slate-400 font-medium">
                                    {timeLeft > 0
                                        ? `Resend code in 00:${timeLeft.toString().padStart(2, '0')}`
                                        : "Didn't receive the code?"}
                                </span>
                                {timeLeft === 0 && (
                                    <button
                                        onClick={handleResendCode}
                                        className="text-indigo-500 font-bold hover:text-indigo-400 transition-colors uppercase tracking-widest text-xs"
                                    >
                                        Resend Code
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Navigation Buttons for previous steps */}
                    {step > 1 && (
                        <button
                            onClick={() => setStep(step - 1)}
                            className="mt-8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm font-bold flex items-center gap-2 mx-auto transition-colors"
                        >
                            <i className="fas fa-arrow-left text-xs"></i>
                            Back
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Onboarding;
