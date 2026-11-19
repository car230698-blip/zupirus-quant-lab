(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function formatUsd(val) {
    if (!Number.isFinite(val)) return '$0.00';
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function floorLot(raw) {
    return Math.floor(raw * 100) / 100;
  }

  function compute() {
    var mode = $('calc-mode').value;
    var balance = Math.max(0, parseFloat($('calc-balance').value) || 0);
    var riskPct = Math.max(0.05, Math.min(25, parseFloat($('calc-risk').value) || 0.75));
    var slPips = Math.max(1, parseFloat($('calc-sl').value) || 35);
    var rr = Math.max(0.5, parseFloat($('calc-rr').value) || 2.0);
    var dailyLimitPct = Math.max(1, Math.min(20, parseFloat($('calc-dd').value) || 5.0));

    // XAU/USD standard: 1.00 lot = 100 oz => 1 pip ($0.10 price move) = $10 per standard lot.
    // XAU/USD Cent (USC): balance input in USD, 1.00 cent lot = 1 oz => 1 pip = $0.10 per cent lot.
    var pipValuePerLot = mode === 'CENT' ? 0.1 : 10.0;
    var riskUsd = balance * (riskPct / 100);
    var slPriceMove = slPips * 0.1;
    var rawLot = riskUsd / (slPips * pipValuePerLot);
    var safeLot = floorLot(rawLot);
    var actualRiskUsd = safeLot * slPips * pipValuePerLot;
    var targetProfitUsd = actualRiskUsd * rr;

    var guardPct = Math.max(1, dailyLimitPct - 1.0);
    var maxLossesBroker = riskPct > 0 ? Math.floor(dailyLimitPct / riskPct) : 0;
    var maxLossesGuard = riskPct > 0 ? Math.floor(guardPct / riskPct) : 0;

    $('out-lot').textContent = safeLot.toFixed(2) + (mode === 'CENT' ? ' Cent Lot' : ' Lot');
    $('out-raw-lot').textContent = 'Chính xác: ' + rawLot.toFixed(4) + ' · Làm tròn xuống (Fail-Closed)';
    $('out-risk-usd').textContent = formatUsd(actualRiskUsd);
    $('out-target-usd').textContent = '+' + formatUsd(targetProfitUsd);
    $('out-sl-usd').textContent = slPips.toFixed(0) + ' pips ($' + slPriceMove.toFixed(2) + '/oz)';
    $('out-guard-losses').textContent = maxLossesGuard + ' lệnh (khóa ' + guardPct.toFixed(1) + '%)';
    $('out-broker-losses').textContent = maxLossesBroker + ' lệnh (sàn ' + dailyLimitPct.toFixed(1) + '%)';

    var alertBox = $('calc-alert');
    var msgs = [];
    if (rawLot < 0.01) {
      msgs.push('FAIL-CLOSED: Khối lượng tính ra (' + rawLot.toFixed(4) + ' lot) nhỏ hơn min lot 0.01. Hệ thống ZUPIRUS sẽ từ chối vào lệnh để không vượt ngân sách rủi ro.');
    }
    if ((mode === 'PROP_CHALLENGE' || mode === 'PROP_LIVE') && riskPct > 1.0) {
      msgs.push('CẢNH BÁO PROP FIRM: Rủi ro ' + riskPct.toFixed(2) + '%/lệnh vượt trần an toàn 1.0% cho tài khoản quỹ. Khuyến nghị 0.50% - 0.75% để tránh vi phạm Daily Drawdown.');
    }
    if (slPips < 15) {
      msgs.push('LƯU Ý SL NGẮN: Stop Loss dưới 15 pips ($1.50/oz) rất dễ bị quét nhiễu Spread/Wick trên XAU/USD phiên Âu-Mỹ.');
    }

    if (msgs.length > 0) {
      alertBox.style.display = 'block';
      alertBox.textContent = msgs.join(' ');
    } else {
      alertBox.style.display = 'none';
      alertBox.textContent = '';
    }
  }

  function bindPresets() {
    var balanceBtns = document.querySelectorAll('[data-preset-balance]');
    balanceBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('calc-balance').value = btn.getAttribute('data-preset-balance');
        compute();
      });
    });

    var riskBtns = document.querySelectorAll('[data-preset-risk]');
    riskBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('calc-risk').value = btn.getAttribute('data-preset-risk');
        compute();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var ids = ['calc-mode', 'calc-balance', 'calc-risk', 'calc-sl', 'calc-rr', 'calc-dd'];
    ids.forEach(function (id) {
      var el = $(id);
      if (el) {
        el.addEventListener('input', compute);
        el.addEventListener('change', compute);
      }
    });
    bindPresets();
    compute();
  });
})();
