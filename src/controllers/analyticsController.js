const { UserOrder, Nalco } = require('../models/Order');
const User = require('../models/User');
const { GlaziaInventory } = require('../models/GlaziaInventory');
const { DealershipInventory } = require('../models/DealershipInventory');
const StockAdjustmentRequest = require('../models/StockAdjustmentRequest');
const TrackPhone = require('../models/TrackPhone');

/**
 * Helper to compute month-year key and label
 */
const getMonthDetails = (date) => {
  const d = new Date(date);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
    shortLabel: monthNames[d.getMonth()],
  };
};

/**
 * Main Admin Analytics Controller
 * Provides all high-level KPIs, time-series chart data, categorical distributions,
 * top rankings, and operational alerts for the Admin Dashboard.
 */
const getAdminAnalytics = async (req, res) => {
  try {
    const now = new Date();

    // Time boundary helpers
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Run parallel aggregation and queries
    const [
      overallOrderStats,
      monthlyOrderTrends,
      dailyOrderTrends,
      deliveryTypeDistribution,
      fulfillmentStatusDistribution,
      topProductsAgg,
      topCitiesAgg,
      topCustomersAgg,
      paymentStatsAgg,
      userStatsAgg,
      userMonthlyGrowthAgg,
      inventoryStatsAgg,
      inventoryCategoryAgg,
      lowStockItems,
      dealershipInventoryAgg,
      pendingStockRequestsCount,
      leadsStatsAgg,
      latestNalco,
      recentOrders,
      pendingPaymentProofs
    ] = await Promise.all([
      // 1. Overall Order KPIs
      UserOrder.aggregate([
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: { $ifNull: ['$totalAmount', 0] } },
            completedOrders: {
              $sum: { $cond: [{ $eq: ['$isComplete', true] }, 1, 0] },
            },
            pendingOrders: {
              $sum: { $cond: [{ $eq: ['$isComplete', false] }, 1, 0] },
            },
            thisMonthOrders: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$createdAt', startOfCurrentMonth] },
                      { $lte: ['$createdAt', endOfCurrentMonth] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            thisMonthRevenue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$createdAt', startOfCurrentMonth] },
                      { $lte: ['$createdAt', endOfCurrentMonth] },
                    ],
                  },
                  { $ifNull: ['$totalAmount', 0] },
                  0,
                ],
              },
            },
            lastMonthOrders: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$createdAt', startOfLastMonth] },
                      { $lte: ['$createdAt', endOfLastMonth] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            lastMonthRevenue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$createdAt', startOfLastMonth] },
                      { $lte: ['$createdAt', endOfLastMonth] },
                    ],
                  },
                  { $ifNull: ['$totalAmount', 0] },
                  0,
                ],
              },
            },
          },
        },
      ]),

      // 2. Monthly Revenue & Order Trends (Last 6 Months)
      UserOrder.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
            },
            revenue: { $sum: { $ifNull: ['$totalAmount', 0] } },
            totalOrders: { $sum: 1 },
            completedOrders: {
              $sum: { $cond: [{ $eq: ['$isComplete', true] }, 1, 0] },
            },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),

      // 3. Daily Order & Revenue Trends (Last 30 Days)
      UserOrder.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            revenue: { $sum: { $ifNull: ['$totalAmount', 0] } },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // 4. Delivery Type Breakdown (Pie / Doughnut Chart)
      UserOrder.aggregate([
        {
          $group: {
            _id: { $ifNull: ['$deliveryType', 'SELF'] },
            count: { $sum: 1 },
            revenue: { $sum: { $ifNull: ['$totalAmount', 0] } },
          },
        },
        { $sort: { count: -1 } },
      ]),

      // 5. Fulfillment Status Breakdown (Pie / Doughnut Chart)
      UserOrder.aggregate([
        {
          $group: {
            _id: { $ifNull: ['$fulfillment.status', 'GLAZIA_DIRECT'] },
            count: { $sum: 1 },
            revenue: { $sum: { $ifNull: ['$totalAmount', 0] } },
          },
        },
        { $sort: { count: -1 } },
      ]),

      // 6. Top 10 Selling Products by Volume and Revenue (Bar Graph)
      UserOrder.aggregate([
        { $unwind: '$products' },
        {
          $group: {
            _id: '$products.productId',
            description: { $first: '$products.description' },
            totalQuantity: { $sum: { $ifNull: ['$products.quantity', 0] } },
            totalAmount: { $sum: { $ifNull: ['$products.amount', 0] } },
            orderOccurrences: { $sum: 1 },
          },
        },
        { $sort: { totalQuantity: -1 } },
        { $limit: 10 },
      ]),

      // 7. Top 8 Cities by Order Volume and Revenue (Bar Graph)
      UserOrder.aggregate([
        {
          $group: {
            _id: {
              $trim: {
                input: { $ifNull: ['$user.city', 'Unknown'] },
              },
            },
            ordersCount: { $sum: 1 },
            totalRevenue: { $sum: { $ifNull: ['$totalAmount', 0] } },
          },
        },
        { $match: { _id: { $ne: '' } } },
        { $sort: { totalRevenue: -1 } },
        { $limit: 8 },
      ]),

      // 8. Top 8 Buyers/Fabricators by Total Spend (Bar Graph / Leaderboard)
      UserOrder.aggregate([
        {
          $group: {
            _id: '$user.userId',
            name: { $first: '$user.name' },
            phoneNumber: { $first: '$user.phoneNumber' },
            city: { $first: '$user.city' },
            ordersCount: { $sum: 1 },
            totalSpend: { $sum: { $ifNull: ['$totalAmount', 0] } },
          },
        },
        { $sort: { totalSpend: -1 } },
        { $limit: 8 },
      ]),

      // 9. Payment Collection & Overdue Stats
      UserOrder.aggregate([
        { $unwind: '$payments' },
        {
          $group: {
            _id: null,
            totalScheduledPaymentAmount: { $sum: { $ifNull: ['$payments.amount', 0] } },
            totalCollectedAmount: {
              $sum: {
                $cond: [
                  { $eq: ['$payments.isApproved', true] },
                  { $ifNull: ['$payments.depositedAmount', '$payments.amount'] },
                  0,
                ],
              },
            },
            pendingPaymentApprovalCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$payments.proofAdded', true] },
                      { $eq: ['$payments.isApproved', false] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            overduePaymentsCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$payments.isApproved', false] },
                      { $lt: ['$payments.dueDate', now] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),

      // 10. User Statistics (Fabricators, Dealerships, Active Status)
      User.aggregate([
        {
          $group: {
            _id: null,
            totalUsers: { $sum: 1 },
            fabricators: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$accountType', 'FABRICATOR'] },
                      { $not: ['$accountType'] },
                      { $eq: [{ $ifNull: ['$accountType', ''] }, ''] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            dealerships: {
              $sum: { $cond: [{ $eq: ['$accountType', 'DEALERSHIP'] }, 1, 0] },
            },
            admins: {
              $sum: { $cond: [{ $eq: ['$accountType', 'ADMIN'] }, 1, 0] },
            },
            activeUsers: {
              $sum: { $cond: [{ $ne: ['$isActive', false] }, 1, 0] },
            },
            partnerAgreementAccepted: {
              $sum: { $cond: [{ $eq: ['$partnerAgreement.accepted', true] }, 1, 0] },
            },
            newUsersThisMonth: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$createdAt', startOfCurrentMonth] },
                      { $lte: ['$createdAt', endOfCurrentMonth] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),

      // 11. User Monthly Growth (Last 6 Months)
      User.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              accountType: { $ifNull: ['$accountType', 'FABRICATOR'] },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),

      // 12. Glazia Inventory Stock Summary
      GlaziaInventory.aggregate([
        {
          $group: {
            _id: null,
            totalSKUs: { $sum: 1 },
            totalUnits: { $sum: { $ifNull: ['$quantity', 0] } },
            lowStockCount: {
              $sum: {
                $cond: [{ $lte: ['$quantity', '$reorderLevel'] }, 1, 0],
              },
            },
          },
        },
      ]),

      // 13. Glazia Inventory Category Breakdown (Pie / Doughnut Chart)
      GlaziaInventory.aggregate([
        {
          $group: {
            _id: { $ifNull: ['$category', 'OTHER'] },
            itemCount: { $sum: 1 },
            totalQuantity: { $sum: { $ifNull: ['$quantity', 0] } },
          },
        },
        { $sort: { totalQuantity: -1 } },
      ]),

      // 14. Top Low Stock Items (Operational Alert Feed)
      GlaziaInventory.find({
        $expr: { $lte: ['$quantity', '$reorderLevel'] },
      })
        .select('productId description category quantity reorderLevel updatedAt')
        .sort({ quantity: 1 })
        .limit(8)
        .lean(),

      // 15. Dealership Network Inventory Total
      DealershipInventory.aggregate([
        {
          $group: {
            _id: null,
            totalDealershipUnits: { $sum: { $ifNull: ['$quantity', 0] } },
            totalDealershipSKUs: { $sum: 1 },
          },
        },
      ]),

      // 16. Pending Dealership Stock Adjustment Requests Count
      StockAdjustmentRequest.countDocuments({ status: 'PENDING' }),

      // 17. Leads Pipeline Summary (From TrackPhone)
      TrackPhone.aggregate([
        {
          $group: {
            _id: { $ifNull: ['$status', 'new'] },
            count: { $sum: 1 },
          },
        },
      ]),

      // 18. Nalco Latest Benchmark Price
      Nalco.findOne().sort({ date: -1 }).lean(),

      // 19. Recent 8 Orders for Live Dashboard Feed
      UserOrder.find()
        .select('orderId user totalAmount isComplete deliveryType fulfillment.status createdAt')
        .sort({ createdAt: -1 })
        .limit(8)
        .lean(),

      // 20. Payments Awaiting Approval
      UserOrder.find({
        'payments.proofAdded': true,
        'payments.isApproved': false,
      })
        .select('orderId user payments totalAmount createdAt')
        .sort({ 'payments.proofAddedAt': -1 })
        .limit(5)
        .lean(),
    ]);

    // Parse Order KPI summary
    const orderStats = overallOrderStats[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      completedOrders: 0,
      pendingOrders: 0,
      thisMonthOrders: 0,
      thisMonthRevenue: 0,
      lastMonthOrders: 0,
      lastMonthRevenue: 0,
    };

    const completionRate = orderStats.totalOrders > 0
      ? Number(((orderStats.completedOrders / orderStats.totalOrders) * 100).toFixed(1))
      : 0;

    const averageOrderValue = orderStats.totalOrders > 0
      ? Math.round(orderStats.totalRevenue / orderStats.totalOrders)
      : 0;

    const revenueGrowthMoM = orderStats.lastMonthRevenue > 0
      ? Number((((orderStats.thisMonthRevenue - orderStats.lastMonthRevenue) / orderStats.lastMonthRevenue) * 100).toFixed(1))
      : orderStats.thisMonthRevenue > 0 ? 100 : 0;

    const ordersGrowthMoM = orderStats.lastMonthOrders > 0
      ? Number((((orderStats.thisMonthOrders - orderStats.lastMonthOrders) / orderStats.lastMonthOrders) * 100).toFixed(1))
      : orderStats.thisMonthOrders > 0 ? 100 : 0;

    // Parse User KPIs
    const userStats = userStatsAgg[0] || {
      totalUsers: 0,
      fabricators: 0,
      dealerships: 0,
      admins: 0,
      activeUsers: 0,
      partnerAgreementAccepted: 0,
      newUsersThisMonth: 0,
    };

    // Parse Payment KPIs
    const payments = paymentStatsAgg[0] || {
      totalScheduledPaymentAmount: 0,
      totalCollectedAmount: 0,
      pendingPaymentApprovalCount: 0,
      overduePaymentsCount: 0,
    };

    const pendingPaymentAmount = Math.max(0, orderStats.totalRevenue - payments.totalCollectedAmount);

    // Parse Glazia Inventory KPIs
    const glaziaInv = inventoryStatsAgg[0] || {
      totalSKUs: 0,
      totalUnits: 0,
      lowStockCount: 0,
    };

    const dealerInv = dealershipInventoryAgg[0] || {
      totalDealershipUnits: 0,
      totalDealershipSKUs: 0,
    };

    // Parse Leads
    const leadMap = { new: 0, contacted: 0, closed: 0 };
    let totalLeads = 0;
    leadsStatsAgg.forEach((item) => {
      const key = (item._id || 'new').toLowerCase();
      leadMap[key] = (leadMap[key] || 0) + item.count;
      totalLeads += item.count;
    });

    const leadConversionRate = totalLeads > 0
      ? Number(((leadMap.closed / totalLeads) * 100).toFixed(1))
      : 0;

    // Format Monthly Trends (Ensure continuous 6-month array)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyTrendsFormatted = [];
    for (let i = 5; i >= 0; i--) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = targetDate.getFullYear();
      const m = targetDate.getMonth() + 1;
      const label = `${monthNames[m - 1]} ${y}`;
      const shortMonth = monthNames[m - 1];

      const found = monthlyOrderTrends.find(
        (item) => item._id.year === y && item._id.month === m
      );

      monthlyTrendsFormatted.push({
        label,
        shortMonth,
        year: y,
        month: m,
        revenue: found ? Math.round(found.revenue) : 0,
        orders: found ? found.totalOrders : 0,
        completedOrders: found ? found.completedOrders : 0,
      });
    }

    // Format User Growth Monthly Trends
    const userGrowthTimeline = [];
    for (let i = 5; i >= 0; i--) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = targetDate.getFullYear();
      const m = targetDate.getMonth() + 1;
      const label = `${monthNames[m - 1]} ${y}`;

      const fabricatorsCount = userMonthlyGrowthAgg
        .filter((u) => u._id.year === y && u._id.month === m && u._id.accountType === 'FABRICATOR')
        .reduce((sum, u) => sum + u.count, 0);

      const dealershipsCount = userMonthlyGrowthAgg
        .filter((u) => u._id.year === y && u._id.month === m && u._id.accountType === 'DEALERSHIP')
        .reduce((sum, u) => sum + u.count, 0);

      userGrowthTimeline.push({
        label,
        fabricators: fabricatorsCount,
        dealerships: dealershipsCount,
        total: fabricatorsCount + dealershipsCount,
      });
    }

    // Format Delivery Types (Pie Chart)
    const deliveryTypeLabels = {
      FULL: 'Full Truckload',
      PART: 'Part Load',
      SELF: 'Self Pickup',
    };
    const deliveryTypeColors = {
      FULL: '#3b82f6', // Blue
      PART: '#f59e0b', // Amber
      SELF: '#10b981', // Emerald
    };

    const deliveryTypeChart = deliveryTypeDistribution.map((item) => ({
      type: item._id,
      name: deliveryTypeLabels[item._id] || item._id,
      value: item.count,
      revenue: Math.round(item.revenue),
      color: deliveryTypeColors[item._id] || '#6366f1',
    }));

    // Format Fulfillment Statuses (Doughnut Chart)
    const fulfillmentLabels = {
      GLAZIA_DIRECT: 'Glazia Direct',
      DEALER_STOCK: 'Dealer Stock',
      AWAITING_DEALER: 'Awaiting Dealer',
      GLAZIA_VIA_DEALER: 'Glazia via Dealer',
    };
    const fulfillmentColors = {
      GLAZIA_DIRECT: '#3b82f6',
      DEALER_STOCK: '#10b981',
      AWAITING_DEALER: '#f59e0b',
      GLAZIA_VIA_DEALER: '#8b5cf6',
    };

    const fulfillmentChart = fulfillmentStatusDistribution.map((item) => ({
      status: item._id,
      name: fulfillmentLabels[item._id] || item._id,
      value: item.count,
      revenue: Math.round(item.revenue),
      color: fulfillmentColors[item._id] || '#94a3b8',
    }));

    // Format Inventory Categories (Pie Chart)
    const categoryColors = {
      PROFILE: '#2563eb',
      HARDWARE: '#ec4899',
      OTHER: '#64748b',
    };

    const inventoryCategoryChart = inventoryCategoryAgg.map((item) => ({
      category: item._id,
      name: item._id === 'PROFILE' ? 'Profiles' : item._id === 'HARDWARE' ? 'Hardware' : 'Other',
      itemCount: item.itemCount,
      totalQuantity: item.totalQuantity,
      color: categoryColors[item._id] || '#6366f1',
    }));

    // Format User Roles (Doughnut Chart)
    const userRolesChart = [
      { name: 'Fabricators', value: userStats.fabricators, color: '#3b82f6' },
      { name: 'Dealerships', value: userStats.dealerships, color: '#10b981' },
      { name: 'Admins', value: userStats.admins, color: '#f59e0b' },
    ];

    // Format Leads Status (Pie Chart)
    const leadsPipelineChart = [
      { status: 'new', name: 'New Inquiries', value: leadMap.new, color: '#3b82f6' },
      { status: 'contacted', name: 'Contacted / In Discussion', value: leadMap.contacted, color: '#f59e0b' },
      { status: 'closed', name: 'Converted / Closed', value: leadMap.closed, color: '#10b981' },
    ];

    // Structure Clean and Comprehensive Response
    return res.status(200).json({
      success: true,
      data: {
        // Direct KPI Numbers for Top Summary Cards
        summary: {
          revenue: {
            totalRevenue: Math.round(orderStats.totalRevenue),
            thisMonthRevenue: Math.round(orderStats.thisMonthRevenue),
            lastMonthRevenue: Math.round(orderStats.lastMonthRevenue),
            growthPercentage: revenueGrowthMoM,
            averageOrderValue,
            totalCollectedAmount: Math.round(payments.totalCollectedAmount),
            pendingPaymentAmount: Math.round(pendingPaymentAmount),
          },
          orders: {
            totalOrders: orderStats.totalOrders,
            completedOrders: orderStats.completedOrders,
            pendingOrders: orderStats.pendingOrders,
            completionRatePercentage: completionRate,
            thisMonthOrders: orderStats.thisMonthOrders,
            lastMonthOrders: orderStats.lastMonthOrders,
            growthPercentage: ordersGrowthMoM,
          },
          users: {
            totalUsers: userStats.totalUsers,
            fabricators: userStats.fabricators,
            dealerships: userStats.dealerships,
            admins: userStats.admins,
            activeUsers: userStats.activeUsers,
            partnerAgreementsSigned: userStats.partnerAgreementAccepted,
            newUsersThisMonth: userStats.newUsersThisMonth,
          },
          inventory: {
            totalSKUs: glaziaInv.totalSKUs,
            totalUnits: glaziaInv.totalUnits,
            lowStockCount: glaziaInv.lowStockCount,
            dealershipTotalUnits: dealerInv.totalDealershipUnits,
            dealershipTotalSKUs: dealerInv.totalDealershipSKUs,
            pendingStockAdjustmentRequests: pendingStockRequestsCount,
          },
          leads: {
            totalLeads,
            newLeads: leadMap.new,
            contactedLeads: leadMap.contacted,
            closedLeads: leadMap.closed,
            conversionRatePercentage: leadConversionRate,
          },
          nalco: {
            latestPrice: latestNalco?.nalcoPrice || null,
            date: latestNalco?.date || null,
          },
          alerts: {
            lowStockCount: glaziaInv.lowStockCount,
            pendingPaymentProofsCount: payments.pendingPaymentApprovalCount,
            overduePaymentsCount: payments.overduePaymentsCount,
            pendingStockAdjustmentRequestsCount: pendingStockRequestsCount,
          },
        },

        // Charts & Graphs Datasets
        charts: {
          // Line & Area Chart: Monthly Trends (Revenue & Orders)
          monthlyRevenueTrends: monthlyTrendsFormatted,

          // Bar / Area Chart: Daily Trends (Last 30 Days)
          dailyTrends: dailyOrderTrends.map((d) => ({
            date: d._id,
            revenue: Math.round(d.revenue),
            orders: d.orders,
          })),

          // Line / Bar Chart: Monthly User Growth
          userGrowthTimeline,

          // Pie / Doughnut Chart: Orders by Delivery Type
          deliveryTypeDistribution: deliveryTypeChart,

          // Pie / Doughnut Chart: Orders by Fulfillment Status
          fulfillmentStatusDistribution: fulfillmentChart,

          // Pie / Doughnut Chart: Inventory by Category
          inventoryCategoryBreakdown: inventoryCategoryChart,

          // Doughnut Chart: User Roles Distribution
          userRolesDistribution: userRolesChart,

          // Pie Chart: Leads Funnel
          leadsPipelineDistribution: leadsPipelineChart,

          // Bar Graph: Top 10 Products by Quantity & Revenue
          topProducts: topProductsAgg.map((p) => ({
            productId: p._id,
            description: p.description || p._id,
            totalQuantity: p.totalQuantity,
            totalAmount: Math.round(p.totalAmount),
            orderOccurrences: p.orderOccurrences,
          })),

          // Bar Graph: Top Cities by Revenue & Orders
          topCities: topCitiesAgg.map((c) => ({
            city: c._id,
            ordersCount: c.ordersCount,
            totalRevenue: Math.round(c.totalRevenue),
          })),

          // Bar Graph / Leaderboard: Top Buyers
          topCustomers: topCustomersAgg.map((u) => ({
            userId: u._id,
            name: u.name || 'Anonymous',
            phoneNumber: u.phoneNumber,
            city: u.city || '',
            ordersCount: u.ordersCount,
            totalSpend: Math.round(u.totalSpend),
          })),
        },

        // Quick Feeds and Alerts for Tables/Lists
        feeds: {
          lowStockAlerts: lowStockItems,
          recentOrders: recentOrders.map((o) => ({
            orderId: o.orderId,
            customerName: o.user?.name || 'N/A',
            city: o.user?.city || 'N/A',
            phoneNumber: o.user?.phoneNumber || '',
            totalAmount: o.totalAmount || 0,
            isComplete: o.isComplete || false,
            deliveryType: o.deliveryType,
            fulfillmentStatus: o.fulfillment?.status || 'GLAZIA_DIRECT',
            createdAt: o.createdAt,
          })),
          pendingPaymentApprovals: pendingPaymentProofs.map((o) => ({
            orderId: o.orderId,
            customerName: o.user?.name || 'N/A',
            phoneNumber: o.user?.phoneNumber || '',
            totalAmount: o.totalAmount || 0,
            pendingPayments: (o.payments || []).filter((p) => p.proofAdded && !p.isApproved),
            createdAt: o.createdAt,
          })),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching admin analytics:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch admin analytics',
      error: error.message,
    });
  }
};

/**
 * Filtered Revenue & Order Trend Controller
 * Allows querying specific date ranges or custom timeframes (e.g. ?timeframe=7d | 30d | 90d | 1y | custom)
 */
const getFilteredAnalytics = async (req, res) => {
  try {
    const { timeframe = '30d', startDate, endDate } = req.query;
    let fromDate;
    let toDate = endDate ? new Date(endDate) : new Date();

    if (startDate) {
      fromDate = new Date(startDate);
    } else {
      const now = new Date();
      switch (timeframe) {
        case '7d':
          fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case '1y':
          fromDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
          break;
        case '30d':
        default:
          fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }
    }

    const [filteredOrders, filteredStats] = await Promise.all([
      UserOrder.aggregate([
        {
          $match: {
            createdAt: { $gte: fromDate, $lte: toDate },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            revenue: { $sum: { $ifNull: ['$totalAmount', 0] } },
            orders: { $sum: 1 },
            completedOrders: {
              $sum: { $cond: [{ $eq: ['$isComplete', true] }, 1, 0] },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      UserOrder.aggregate([
        {
          $match: {
            createdAt: { $gte: fromDate, $lte: toDate },
          },
        },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: { $ifNull: ['$totalAmount', 0] } },
            completedOrders: {
              $sum: { $cond: [{ $eq: ['$isComplete', true] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const stats = filteredStats[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      completedOrders: 0,
    };

    return res.status(200).json({
      success: true,
      timeframe,
      range: { from: fromDate, to: toDate },
      summary: {
        totalOrders: stats.totalOrders,
        totalRevenue: Math.round(stats.totalRevenue),
        completedOrders: stats.completedOrders,
        averageOrderValue: stats.totalOrders > 0 ? Math.round(stats.totalRevenue / stats.totalOrders) : 0,
      },
      timeline: filteredOrders.map((d) => ({
        date: d._id,
        revenue: Math.round(d.revenue),
        orders: d.orders,
        completedOrders: d.completedOrders,
      })),
    });
  } catch (error) {
    console.error('Error fetching filtered analytics:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch filtered analytics',
      error: error.message,
    });
  }
};

module.exports = {
  getAdminAnalytics,
  getFilteredAnalytics,
};
