// Small, dependency-free statistical helper for the Progress trend chart.

// Two-sided 95% Student-t critical values. We use the next-lower available
// degrees of freedom where an exact row is absent, which is slightly more
// conservative than interpolating toward 1.96.
const T95_SMALL = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];

function tCritical95(df){
  if(df <= 0) return null;
  if(df <= 10) return T95_SMALL[df - 1];
  if(df <= 12) return 2.179;
  if(df <= 15) return 2.131;
  if(df <= 20) return 2.086;
  if(df <= 25) return 2.060;
  if(df <= 30) return 2.042;
  if(df <= 40) return 2.021;
  if(df <= 60) return 2.000;
  if(df <= 120) return 1.980;
  return 1.960;
}

export function linearRegressionIntervals(values){
  const ys = (values || []).map(Number).filter(Number.isFinite);
  const n = ys.length;
  if(n === 0) return { n: 0, points: [], intervalAvailable: false };

  const xs = ys.map((_, i)=> i);
  const xMean = xs.reduce((a,b)=> a+b, 0) / n;
  const yMean = ys.reduce((a,b)=> a+b, 0) / n;
  const sxx = xs.reduce((sum,x)=> sum + (x - xMean) ** 2, 0);
  const slope = sxx ? xs.reduce((sum,x,i)=> sum + (x - xMean) * (ys[i] - yMean), 0) / sxx : 0;
  const intercept = yMean - slope * xMean;
  const fitted = xs.map(x=> intercept + slope * x);
  const ssRes = ys.reduce((sum,y,i)=> sum + (y - fitted[i]) ** 2, 0);
  const residualStdError = n > 2 ? Math.sqrt(ssRes / (n - 2)) : null;
  const critical = tCritical95(n - 2);
  const intervalAvailable = critical != null && residualStdError != null && sxx > 0;

  const points = xs.map((x,i)=>{
    const fit = fitted[i];
    if(!intervalAvailable){
      return { observed: ys[i], fitted: fit, confidenceLow: null, confidenceHigh: null };
    }
    const leverage = 1 / n + ((x - xMean) ** 2) / sxx;
    const half = critical * residualStdError * Math.sqrt(leverage);
    return {
      observed: ys[i], fitted: fit,
      confidenceLow: fit - half,
      confidenceHigh: fit + half,
    };
  });

  return { n, slope, residualStdError, intervalAvailable, points };
}
