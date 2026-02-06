
import { BIDashboard, BIWidget } from '../types';

export const SAMPLE_DASHBOARDS: Partial<BIDashboard>[] = [
    {
        title: 'Sales Analytics',
        description: 'Overview of sales performance, revenue trends, and top products.',
        widgets: [
            {
                id: 'w-sales-1',
                type: 'card',
                title: 'Total Revenue',
                x: 0,
                y: 0,
                w: 3,
                h: 2,
                metric: 'Revenue',
                comparisonValue: '1200000',
                trend: 'up',
                colors: ['#10b981']
            },
            {
                id: 'w-sales-2',
                type: 'card',
                title: 'Orders',
                x: 3,
                y: 0,
                w: 3,
                h: 2,
                metric: 'Orders',
                comparisonValue: '500',
                trend: 'up',
                colors: ['#3b82f6']
            },
            {
                id: 'w-sales-3',
                type: 'card',
                title: 'Average Order Value',
                x: 6,
                y: 0,
                w: 3,
                h: 2,
                metric: 'AOV',
                comparisonValue: '150',
                trend: 'down',
                colors: ['#f59e0b']
            },
            {
                id: 'w-sales-4',
                type: 'card',
                title: 'Conversion Rate',
                x: 9,
                y: 0,
                w: 3,
                h: 2,
                metric: 'Conversion',
                comparisonValue: '0.02',
                trend: 'up',
                colors: ['#8b5cf6']
            },
            {
                id: 'w-sales-5',
                type: 'chart',
                chartType: 'bar',
                title: 'Revenue by Region',
                x: 0,
                y: 2,
                w: 6,
                h: 4,
                xAxis: 'Region',
                yAxis: ['Revenue'],
                colors: ['#6366f1']
            },
            {
                id: 'w-sales-6',
                type: 'chart',
                chartType: 'line',
                title: 'Sales Trend',
                x: 6,
                y: 2,
                w: 6,
                h: 4,
                xAxis: 'Date',
                yAxis: ['Sales'],
                colors: ['#ec4899']
            },
            {
                id: 'w-sales-7',
                type: 'chart',
                chartType: 'pie',
                title: 'Category Share',
                x: 0,
                y: 6,
                w: 4,
                h: 4,
                xAxis: 'Category',
                yAxis: ['Revenue'],
                colors: ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']
            },
            {
                id: 'w-sales-8',
                type: 'table',
                title: 'Top Products',
                x: 4,
                y: 6,
                w: 8,
                h: 4,
                columns: [
                    { field: 'Product', header: 'Product Name' },
                    { field: 'Category', header: 'Category' },
                    { field: 'Price', header: 'Price' },
                    { field: 'Sold', header: 'Units Sold' },
                    { field: 'Revenue', header: 'Total Revenue' }
                ]
            }
        ]
    },
    {
        title: 'Marketing Performance',
        description: 'Track campaign performance, leads, and engagement metrics.',
        widgets: [
            {
                id: 'w-mkt-1',
                type: 'card',
                title: 'Total Leads',
                x: 0,
                y: 0,
                w: 3,
                h: 2,
                metric: 'Leads',
                colors: ['#8b5cf6']
            },
            {
                id: 'w-mkt-2',
                type: 'gauge',
                title: 'Goal Progress',
                x: 3,
                y: 0,
                w: 3,
                h: 2,
                yAxis: ['Leads'],
                comparisonValue: '1000'
            },
            {
                id: 'w-mkt-3',
                type: 'chart',
                chartType: 'line',
                title: 'Traffic Overview',
                x: 0,
                y: 2,
                w: 8,
                h: 4,
                xAxis: 'Date',
                yAxis: ['Visitors', 'Pageviews'],
                colors: ['#3b82f6', '#93c5fd']
            },
            {
                id: 'w-mkt-4',
                type: 'chart',
                chartType: 'donut',
                title: 'Traffic Sources',
                x: 8,
                y: 2,
                w: 4,
                h: 4,
                xAxis: 'Source',
                yAxis: ['Visitors'],
                colors: ['#f59e0b', '#ef4444', '#10b981', '#3b82f6']
            }
        ]
    },
    {
        title: 'Financial Overview',
        description: 'Financial health monitoring, expenses, and profit margins.',
        widgets: [
            {
                id: 'w-fin-1',
                type: 'card',
                title: 'Net Profit',
                x: 0,
                y: 0,
                w: 4,
                h: 2,
                metric: 'Profit',
                colors: ['#10b981']
            },
            {
                id: 'w-fin-2',
                type: 'card',
                title: 'Operating Expenses',
                x: 4,
                y: 0,
                w: 4,
                h: 2,
                metric: 'Expenses',
                colors: ['#ef4444']
            },
            {
                id: 'w-fin-3',
                type: 'card',
                title: 'Gross Margin',
                x: 8,
                y: 0,
                w: 4,
                h: 2,
                metric: 'Margin',
                colors: ['#f59e0b']
            },
            {
                id: 'w-fin-4',
                type: 'chart',
                chartType: 'combo',
                title: 'Revenue vs Expenses',
                x: 0,
                y: 2,
                w: 12,
                h: 4,
                xAxis: 'Month',
                yAxis: ['Revenue', 'Expenses'],
                colors: ['#10b981', '#ef4444']
            }
        ]
    }
];
