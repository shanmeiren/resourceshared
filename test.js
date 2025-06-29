import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

// 自定义指标
const methods = ['GET', 'POST', 'DELETE'];
const metrics = {
  responseTimes: {},
  rates: {},
  counters: {}
};

methods.forEach(method => {
  metrics.responseTimes[method] = new Trend(`${method.toLowerCase()}_time`);
  metrics.rates[method] = new Rate(`${method.toLowerCase()}_success`);
  metrics.counters[method] = new Counter(`${method.toLowerCase()}_errors`);
});

const globalMetrics = {
  vus: new Gauge('active_vusers'),
  iterations: new Counter('total_iterations'),
  checks: new Rate('checks_per_sec'),
  successRate: new Rate('overall_success_rate')
};

// 测试配置 (基于实际性能调整)
export const options = {
  stages: [
    { duration: '1m', target: 3 },    // 温和预热
    { duration: '3m', target: 7 },    // 逐步加压
    { duration: '4m', target: 10 },   // 稳定压力
    { duration: '2m', target: 3 }     // 冷却阶段
  ],
  thresholds: {
    // 基于当前p95≈2.8s的实际值设置
    'http_req_duration': [
      'p(95)<3100',  // 略高于当前值
      'p(90)<2800'   // 监控p90
    ],
    'overall_success_rate': ['rate>0.75'],  // 当前30%→目标75%
    'checks_per_sec': ['rate>0.5']          // 确保基本活动
  },
  noConnectionReuse: true  // 避免连接池影响测试
};

// 测试数据生成器
function generateTestData(vuId, iter) {
  return {
    id: vuId * 1000 + iter,
    value: `vu${vuId}_iter${iter}_${Date.now()}`,
    timestamp: new Date().toISOString()
  };
}

export default function () {
  const baseUrl = 'http://192.168.136.1:3000';
  const testData = generateTestData(__VU, __ITER);
  globalMetrics.vus.add(__VU);
  globalMetrics.iterations.add(1);

  group('API Test Flow', () => {
    // 1. GET测试
    group('GET /get', () => {
      const start = Date.now();
      let res;
      try {
        res = http.get(`${baseUrl}/get`);
        const duration = Date.now() - start;
        metrics.responseTimes.GET.add(duration);
        
        const ok = check(res, {
          'status is 200': (r) => r.status === 200,
          'has data': (r) => r.body.length > 0
        });
        
        metrics.rates.GET.add(ok);
        globalMetrics.checks.add(ok);
        globalMetrics.successRate.add(ok);
        if (!ok) metrics.counters.GET.add(1);
      } catch (err) {
        metrics.counters.GET.add(1);
        globalMetrics.successRate.add(false);
      }
    });

    // 2. POST测试
    group('POST /post', () => {
      const start = Date.now();
      try {
        const res = http.post(
          `${baseUrl}/post`,
          JSON.stringify(testData),
          { headers: { 'Content-Type': 'application/json' } }
        );
        const duration = Date.now() - start;
        metrics.responseTimes.POST.add(duration);
        
        const ok = check(res, {
          'status is 200': (r) => r.status === 200,
          'id matches': (r) => r.json('id') === testData.id
        });
        
        metrics.rates.POST.add(ok);
        globalMetrics.checks.add(ok);
        globalMetrics.successRate.add(ok);
        if (!ok) metrics.counters.POST.add(1);
      } catch (err) {
        metrics.counters.POST.add(1);
        globalMetrics.successRate.add(false);
      }
    });

    // 3. DELETE测试
    group('DELETE /delete', () => {
      const start = Date.now();
      try {
        const res = http.del(
          `${baseUrl}/delete/${testData.id}`,
          null,
          { headers: { 'Content-Type': 'application/json' } }
        );
        const duration = Date.now() - start;
        metrics.responseTimes.DELETE.add(duration);
        
        const ok = check(res, {
          'status is 200': (r) => r.status === 200,
          'is deleted': (r) => r.json('deleted') === true
        });
        
        metrics.rates.DELETE.add(ok);
        globalMetrics.checks.add(ok);
        globalMetrics.successRate.add(ok);
        if (!ok) metrics.counters.DELETE.add(1);
      } catch (err) {
        metrics.counters.DELETE.add(1);
        globalMetrics.successRate.add(false);
      }
    });
  });

  sleep(Math.random() * 1.5 + 0.5); // 0.5-2秒随机等待
}

export function handleSummary(data) {
  return {
    '/tmp/summary.json': JSON.stringify({
      timestamp: new Date().toISOString(),
      metrics: {
        p95: {
          GET: metrics.responseTimes.GET.percentile(95),
          POST: metrics.responseTimes.POST.percentile(95),
          DELETE: metrics.responseTimes.DELETE.percentile(95)
        },
        success_rate: globalMetrics.successRate.count * 100
      }
    })
  };
}