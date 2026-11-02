import React, { useState, useEffect } from 'react';
import { Shield, Users, MessageSquare, DollarSign, TrendingUp, Settings, LogOut, X, User, Building2, Phone, Mail, Globe, MapPin } from 'lucide-react';
import DashboardHeader from './DashboardHeader';

interface MerchantAnalytics {
  merchantId: string;
  merchantName: string;
  merchantEmail: string;
  merchantPhone: string | null;
  merchantAvatarUrl: string | null;
  storeName: string;
  storeHotline: string | null;
  storeSells: string | null;
  storeAddress: string | null;
  totalConversations: number;
  convertedConversations: number;
  totalSales: number;
  totalAiMessages: number;
  joinedAt: string;
}

type TimeFilter = 'all' | '1month' | '3months' | '6months';

export default function AdminDashboard() {
  const [analytics, setAnalytics] = useState<MerchantAnalytics[]>([]);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantAnalytics | null>(null);

  const handleNavigateToSettings = () => {
    window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'settings' }));
  };

  const handleLogout = () => {
    window.dispatchEvent(new Event('shopmate_logout'));
  };

  const handleMerchantClick = (merchant: MerchantAnalytics) => {
    setSelectedMerchant(merchant);
  };

  const handleCloseModal = () => {
    setSelectedMerchant(null);
  };

  useEffect(() => {
    loadAnalytics();
  }, [timeFilter]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/analytics?timeFilter=${timeFilter}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setAnalytics(data);
      } else {
        console.error('Failed to load admin analytics');
      }
    } catch (err) {
      console.error('Error loading analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredAnalytics = analytics.filter(
    (m) =>
      m.merchantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.merchantEmail.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totals = filteredAnalytics.reduce(
    (acc, m) => ({
      merchants: acc.merchants + 1,
      conversations: acc.conversations + m.totalConversations,
      sales: acc.sales + m.totalSales,
      messages: acc.messages + m.totalAiMessages,
    }),
    { merchants: 0, conversations: 0, sales: 0, messages: 0 }
  );

  return (
    <div className="w-full flex-grow flex flex-col text-left bg-[#0a0a0b]">
      <DashboardHeader
        title="ADMIN DASHBOARD"
        searchPlaceholder="Search merchants…"
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
      />

      <div className="w-full flex-grow p-6 md:p-8 overflow-y-auto space-y-6">
        {/* Header with filters and actions */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="font-sans font-bold text-[24px] text-white flex items-center gap-3 tracking-tight">
              <Shield className="text-[#00a8e8] h-6 w-6" />
              Admin Dashboard
            </h1>
            <p className="text-[14px] text-white/60">Platform-wide merchant analytics and performance</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Time filter buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTimeFilter('all')}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  timeFilter === 'all'
                    ? 'bg-gradient-to-r from-[#2176ff] via-[#00a8e8] to-[#00d2ff] text-white'
                    : 'bg-white/[0.05] text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                All Time
              </button>
              <button
                onClick={() => setTimeFilter('1month')}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  timeFilter === '1month'
                    ? 'bg-gradient-to-r from-[#2176ff] via-[#00a8e8] to-[#00d2ff] text-white'
                    : 'bg-white/[0.05] text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                1 Month
              </button>
              <button
                onClick={() => setTimeFilter('3months')}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  timeFilter === '3months'
                    ? 'bg-gradient-to-r from-[#2176ff] via-[#00a8e8] to-[#00d2ff] text-white'
                    : 'bg-white/[0.05] text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                3 Months
              </button>
              <button
                onClick={() => setTimeFilter('6months')}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  timeFilter === '6months'
                    ? 'bg-gradient-to-r from-[#2176ff] via-[#00a8e8] to-[#00d2ff] text-white'
                    : 'bg-white/[0.05] text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                6 Months
              </button>
            </div>

            {/* Settings and Logout buttons */}
            <button
              onClick={handleNavigateToSettings}
              className="p-2.5 bg-white/[0.05] hover:bg-white/[0.08] text-white/60 hover:text-white rounded-lg transition-all"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              onClick={handleLogout}
              className="p-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-lg transition-all"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-white/60">
              <Users className="h-4 w-4" />
              <span className="text-[12px] font-medium uppercase tracking-wider">Total Merchants</span>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-2">
                <div className="w-7 h-7 rounded-full border-2 border-white/20 border-t-[#00a8e8] animate-spin" />
              </div>
            ) : (
              <p className="text-[28px] font-bold text-white">{totals.merchants}</p>
            )}
          </div>

          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-white/60">
              <MessageSquare className="h-4 w-4" />
              <span className="text-[12px] font-medium uppercase tracking-wider">Total Conversations</span>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-2">
                <div className="w-7 h-7 rounded-full border-2 border-white/20 border-t-[#00a8e8] animate-spin" />
              </div>
            ) : (
              <p className="text-[28px] font-bold text-white">{totals.conversations.toLocaleString()}</p>
            )}
          </div>

          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-white/60">
              <DollarSign className="h-4 w-4" />
              <span className="text-[12px] font-medium uppercase tracking-wider">Total Sales by Merchants</span>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-2">
                <div className="w-7 h-7 rounded-full border-2 border-white/20 border-t-[#00a8e8] animate-spin" />
              </div>
            ) : (
              <p className="text-[28px] font-bold text-white">${totals.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            )}
          </div>

          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-white/60">
              <TrendingUp className="h-4 w-4" />
              <span className="text-[12px] font-medium uppercase tracking-wider">AI Messages</span>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-2">
                <div className="w-7 h-7 rounded-full border-2 border-white/20 border-t-[#00a8e8] animate-spin" />
              </div>
            ) : (
              <p className="text-[28px] font-bold text-white">{totals.messages.toLocaleString()}</p>
            )}
          </div>
        </div>

        {/* Merchant list table */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
          <div className="p-6 border-b border-white/[0.06]">
            <h2 className="font-sans font-bold text-[17px] text-white">Merchant Performance</h2>
            <p className="text-[13px] text-white/50 mt-1">
              Detailed analytics for {filteredAnalytics.length} merchant{filteredAnalytics.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.03] border-b border-white/[0.06] text-[11px] font-sans text-white/50 tracking-[0.11em] font-bold">
                  <th className="p-4">Merchant</th>
                  <th className="p-4">Email</th>
                  <th className="p-4 text-center">Conversations</th>
                  <th className="p-4 text-center">Orders Placed</th>
                  <th className="p-4 text-center">Conversion Rate</th>
                  <th className="p-4 text-right">Total Sales</th>
                  <th className="p-4 text-center">AI Messages</th>
                  <th className="p-4">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] font-sans text-[13px]">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-white/40">
                      Loading analytics...
                    </td>
                  </tr>
                ) : filteredAnalytics.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-white/40">
                      No merchants found
                    </td>
                  </tr>
                ) : (
                  filteredAnalytics.map((merchant) => {
                    const conversionRate =
                      merchant.totalConversations > 0
                        ? (merchant.convertedConversations / merchant.totalConversations) * 100
                        : 0;

                    return (
                      <tr key={merchant.merchantId} className="hover:bg-white/[0.02] transition-colors">
                        <td className="p-4">
                          <button
                            onClick={() => handleMerchantClick(merchant)}
                            className="font-bold text-white hover:text-[#00a8e8] transition-colors text-left"
                          >
                            {merchant.merchantName}
                          </button>
                        </td>
                        <td className="p-4 text-white/60">{merchant.merchantEmail}</td>
                        <td className="p-4 text-center text-white/80">{merchant.totalConversations}</td>
                        <td className="p-4 text-center text-emerald-400 font-semibold">
                          {merchant.convertedConversations}
                        </td>
                        <td className="p-4 text-center">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              conversionRate >= 50
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : conversionRate >= 25
                                ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {conversionRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="p-4 text-right text-white font-bold">
                          ${merchant.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-4 text-center text-white/70">{merchant.totalAiMessages.toLocaleString()}</td>
                        <td className="p-4 text-white/40 text-xs">
                          {new Date(merchant.joinedAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Merchant Details Modal */}
      {selectedMerchant && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={handleCloseModal}
        >
          <div
            className="bg-[#0a0a0b] border border-white/[0.08] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-[#0a0a0b] border-b border-white/[0.06] p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                {selectedMerchant.merchantAvatarUrl ? (
                  <img
                    src={selectedMerchant.merchantAvatarUrl}
                    alt={selectedMerchant.merchantName}
                    className="w-14 h-14 rounded-full border-2 border-white/[0.08]"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-gradient-to-r from-[#2176ff] via-[#00a8e8] to-[#00d2ff] flex items-center justify-center">
                    <User className="h-7 w-7 text-white" />
                  </div>
                )}
                <div>
                  <h2 className="font-sans font-bold text-[20px] text-white">{selectedMerchant.merchantName}</h2>
                  <p className="text-[13px] text-white/50">Merchant Details</p>
                </div>
              </div>
              <button
                onClick={handleCloseModal}
                className="p-2 hover:bg-white/[0.05] rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-white/60 hover:text-white" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Personal Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-white/60">
                  <User className="h-5 w-5 text-[#00a8e8]" />
                  <h3 className="font-sans font-bold text-[16px] text-white uppercase tracking-wider">
                    Personal Information
                  </h3>
                </div>
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <User className="h-4 w-4 text-white/40 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1">Full Name</p>
                      <p className="text-[14px] text-white font-medium">{selectedMerchant.merchantName}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="h-4 w-4 text-white/40 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1">Email</p>
                      <p className="text-[14px] text-white font-medium">{selectedMerchant.merchantEmail}</p>
                    </div>
                  </div>
                  {selectedMerchant.merchantPhone && (
                    <div className="flex items-start gap-3">
                      <Phone className="h-4 w-4 text-white/40 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1">Phone</p>
                        <p className="text-[14px] text-white font-medium">{selectedMerchant.merchantPhone}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Business Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-white/60">
                  <Building2 className="h-5 w-5 text-[#00a8e8]" />
                  <h3 className="font-sans font-bold text-[16px] text-white uppercase tracking-wider">
                    Business Information
                  </h3>
                </div>
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <Building2 className="h-4 w-4 text-white/40 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1">Business Name</p>
                      <p className="text-[14px] text-white font-medium">{selectedMerchant.storeName}</p>
                    </div>
                  </div>
                  {selectedMerchant.storeHotline && (
                    <div className="flex items-start gap-3">
                      <Phone className="h-4 w-4 text-white/40 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1">Hotline</p>
                        <p className="text-[14px] text-white font-medium">{selectedMerchant.storeHotline}</p>
                      </div>
                    </div>
                  )}
                  {(selectedMerchant.storeSells || selectedMerchant.storeAddress) && (
                    <div className="flex items-start gap-3">
                      <MapPin className="h-4 w-4 text-white/40 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1">Business Details</p>
                        <p className="text-[14px] text-white font-medium leading-relaxed">
                          {selectedMerchant.storeSells && (<>{selectedMerchant.storeSells}<br /></>)}
                          {selectedMerchant.storeAddress}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Stats */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-white/60">
                  <TrendingUp className="h-5 w-5 text-[#00a8e8]" />
                  <h3 className="font-sans font-bold text-[16px] text-white uppercase tracking-wider">
                    Performance Summary
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                    <p className="text-[11px] text-white/40 uppercase tracking-wider mb-2">Total Sales</p>
                    <p className="text-[20px] font-bold text-emerald-400">
                      ${selectedMerchant.totalSales.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                    <p className="text-[11px] text-white/40 uppercase tracking-wider mb-2">Conversations</p>
                    <p className="text-[20px] font-bold text-white">{selectedMerchant.totalConversations}</p>
                  </div>
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                    <p className="text-[11px] text-white/40 uppercase tracking-wider mb-2">Converted</p>
                    <p className="text-[20px] font-bold text-white">{selectedMerchant.convertedConversations}</p>
                  </div>
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                    <p className="text-[11px] text-white/40 uppercase tracking-wider mb-2">AI Messages</p>
                    <p className="text-[20px] font-bold text-white">{selectedMerchant.totalAiMessages}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
